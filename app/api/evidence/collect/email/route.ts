import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { canAccessEvidenceForEmployee } from "@/lib/evidence-auth";
import { getGraphToken } from "@/lib/azure-graph-token";
import { EVIDENCE_WEIGHTS } from "@/lib/evidence-weights";
import { extractEmailMatchKeywords } from "@/lib/evidence-keywords";
import { createHash } from "crypto";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase config required");
  return createClient(url, key);
}

const GRAPH_BASE = process.env.AZURE_GRAPH_BASE_URL ?? "https://graph.microsoft.com/v1.0";

/** Matches employee sync convention for internal addresses. */
function isInternalEmail(address: string): boolean {
  return address.toLowerCase().endsWith("@dbankjm.com");
}

type WorkplanItemPayload = {
  id: string;
  major_task?: string | null;
  corporate_objective?: string | null;
  division_objective?: string | null;
  individual_objective?: string | null;
  key_output?: string | null;
  performance_standard?: string | null;
};

type GraphMessage = {
  id?: string;
  subject?: string;
  sentDateTime?: string;
  bodyPreview?: string;
  webUrl?: string;
  toRecipients?: Array<{ emailAddress?: { address?: string } }>;
};

async function fetchSentMessagesInRange(
  token: string,
  userId: string,
  startDate: string,
  endDate: string,
  maxMessages: number
): Promise<{ messages: GraphMessage[]; pages: number }> {
  const filter = `sentDateTime ge '${startDate}T00:00:00.000Z' and sentDateTime le '${endDate}T23:59:59.999Z'`;
  const select = ["id", "subject", "sentDateTime", "bodyPreview", "webUrl", "toRecipients"].join(",");
  const messages: GraphMessage[] = [];
  let url: string | null =
    `${GRAPH_BASE}/users/${encodeURIComponent(userId)}/mailFolders/sentitems/messages` +
    `?$filter=${encodeURIComponent(filter)}&$orderby=sentDateTime desc&$select=${select}&$top=100`;
  let pages = 0;
  const maxPages = 6;

  while (url && messages.length < maxMessages && pages < maxPages) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ConsistencyLevel: "eventual",
      },
    });
    if (!res.ok) {
      console.warn("[email-collector] Graph messages error:", await res.text());
      return { messages, pages };
    }
    const data = (await res.json()) as { value?: GraphMessage[]; "@odata.nextLink"?: string };
    const batch = data.value ?? [];
    for (const m of batch) {
      messages.push(m);
      if (messages.length >= maxMessages) break;
    }
    url = data["@odata.nextLink"] ?? null;
    pages++;
  }

  return { messages, pages };
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const {
      employeeId,
      reviewStart,
      reviewEnd,
      graphToken: passedToken,
      workplanItems: rawItems,
      appraisalManagerId,
    } = body as {
      employeeId: string;
      reviewStart?: string;
      reviewEnd?: string;
      graphToken?: string | null;
      workplanItems?: WorkplanItemPayload[];
      appraisalManagerId?: string | null;
    };
    if (!employeeId) return NextResponse.json({ error: "Missing employeeId" }, { status: 400 });

    const supabase = getSupabaseAdmin();

    let verifiedManagerId: string | undefined;
    if (appraisalManagerId) {
      const { data: managed } = await supabase
        .from("appraisals")
        .select("id")
        .eq("employee_id", employeeId)
        .eq("manager_employee_id", appraisalManagerId)
        .limit(1);
      if (managed && managed.length > 0) verifiedManagerId = appraisalManagerId;
    }

    if (!canAccessEvidenceForEmployee(user, employeeId, { appraisalManagerId: verifiedManagerId })) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const workplanItems = Array.isArray(rawItems) ? rawItems : [];

    const token = passedToken ?? (await getGraphToken());
    if (!token) {
      console.warn("[email-collector] No Graph token — returning stub");
      return NextResponse.json({
        collected: 0,
        note: "Azure Graph not connected",
        diagnosis: {
          messagesRaw: 0,
          messagesStored: 0,
          itemsSearched: workplanItems.length,
          itemsWithKeywords: 0,
        },
      });
    }

    const { data: employee } = await supabase
      .from("employees")
      .select("email, aad_object_id")
      .eq("employee_id", employeeId)
      .single();

    if (!employee?.email) {
      console.warn("[email-collector] No email for employee", employeeId);
      return NextResponse.json({
        collected: 0,
        diagnosis: {
          messagesRaw: 0,
          messagesStored: 0,
          itemsSearched: workplanItems.length,
          itemsWithKeywords: 0,
        },
      });
    }

    const startDate = reviewStart ?? new Date().toISOString().slice(0, 10);
    const endDate = reviewEnd ?? startDate;
    const userId = employee.aad_object_id ?? employee.email;

    const itemKeywords = workplanItems.map((item) => {
      const text = [
        item.major_task,
        item.key_output,
        item.corporate_objective,
        item.division_objective,
        item.individual_objective,
        item.performance_standard,
      ]
        .filter(Boolean)
        .join(" ");
      return { item, keywords: extractEmailMatchKeywords(text) };
    });

    const itemsWithKeywords = itemKeywords.filter((x) => x.keywords.length > 0).length;

    if (itemKeywords.length === 0 || itemsWithKeywords === 0) {
      return NextResponse.json({
        collected: 0,
        diagnosis: {
          messagesRaw: 0,
          messagesStored: 0,
          itemsSearched: workplanItems.length,
          itemsWithKeywords,
        },
      });
    }

    const { messages: allSent, pages } = await fetchSentMessagesInRange(token, userId, startDate, endDate, 500);
    const messagesRaw = allSent.length;

    let collected = 0;

    for (const { item, keywords } of itemKeywords) {
      if (keywords.length === 0) continue;

      for (const email of allSent) {
        const id = email.id;
        if (!id) continue;

        const searchable = `${email.subject ?? ""} ${email.bodyPreview ?? ""}`.toLowerCase();
        const matchedKeyword = keywords.find((kw) => searchable.includes(kw));
        if (!matchedKeyword) continue;

        const toEmails: string[] = (email.toRecipients ?? [])
          .map((r) => r.emailAddress?.address?.trim())
          .filter((a): a is string => !!a);
        const hasExternal = toEmails.some((e) => !isInternalEmail(e));
        const activityType = hasExternal ? "email_sent_external" : "email_sent";
        const weight = EVIDENCE_WEIGHTS[activityType] ?? EVIDENCE_WEIGHTS.email_sent ?? 10;

        const sentDay = (email.sentDateTime ?? "").slice(0, 10);
        if (!sentDay) continue;

        const fingerprint = createHash("md5")
          .update(`outlook:${activityType}:${id}:${item.id}`)
          .digest("hex");

        const title = (email.subject ?? "").trim() || "(No subject)";
        const description = [email.bodyPreview?.trim(), `matched: ${matchedKeyword}`].filter(Boolean).join(" · ");

        const { error } = await supabase.from("evidence_items").upsert(
          {
            employee_id: employeeId,
            source_system: "outlook",
            activity_type: activityType,
            title,
            description: description || null,
            activity_date: sentDay,
            reference_url: email.webUrl ?? null,
            related_goal_id: item.id,
            confidence_weight: weight,
            fingerprint,
          },
          { onConflict: "fingerprint", ignoreDuplicates: true }
        );

        if (!error) collected++;
      }
    }

    console.log(
      `[email-collector] pages=${pages} messagesRaw=${messagesRaw} stored=${collected} itemsWithKeywords=${itemsWithKeywords}`
    );

    return NextResponse.json({
      collected,
      diagnosis: {
        messagesRaw,
        messagesStored: collected,
        itemsSearched: workplanItems.length,
        itemsWithKeywords,
      },
    });
  } catch (e) {
    console.error("[evidence/collect/email]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed" },
      { status: 500 }
    );
  }
}
