import type { AiTaskInput } from "./prompts";

/**
 * Deterministic stand-in for a model. Uses only the supplied facts, so it
 * demonstrates the workflow honestly without pretending to be intelligent.
 */
export function mockGenerate(input: AiTaskInput): unknown {
  const { task, business: b, enquiry: e, conversation } = input;
  const sign = b.signature || `Best wishes,\n${b.name}`;
  const hi = `Hi ${e.customerFirstName || "there"},`;
  switch (task.kind) {
    case "draft": {
      const next = b.bookingLink
        ? `If it helps, you can choose a time to talk it through here: ${b.bookingLink}`
        : "Could you let us know a couple of times that suit you to talk it through?";
      return {
        subject: `Re: ${e.subject}`,
        body: `${hi}\n\nThanks for getting in touch with ${b.name} about "${e.subject}". We've read through your message and would be glad to help.\n\n${next}\n\n${sign}`,
        needsConfirmation: [],
      };
    }
    case "rewrite": {
      const opener = { friendly: "Hi", professional: "Dear", concise: "Hi", warm: "Hello" }[task.tone];
      const body = task.draft.body.replace(/^(Hi|Dear|Hello)\b/, opener);
      return { subject: task.draft.subject, body: task.tone === "concise" ? squeeze(body) : body, needsConfirmation: [] };
    }
    case "length":
      return {
        subject: task.draft.subject,
        body:
          task.direction === "shorter"
            ? squeeze(task.draft.body)
            : task.draft.body.replace(sign, `If anything about your request has changed, just reply and let us know.\n\n${sign}`),
        needsConfirmation: [],
      };
    case "questions":
      return {
        questions: [
          "When would you ideally like this done?",
          "Could you share any photos or documents that would help us understand the request?",
          "What is the best number and time to reach you?",
        ],
      };
    case "summarise": {
      const replies = conversation.filter((m) => m.direction === "inbound").length;
      return {
        summary: `${e.customerFirstName || "The customer"} enquired about "${e.subject}" via ${e.source}. Status is ${e.status}. ${conversation.length} email(s) exchanged, ${replies} from the customer.`,
        keyPoints: [e.message.slice(0, 200) || "No message text supplied"],
      };
    }
    case "next_action": {
      const last = conversation[0];
      if (!last) return { action: "reply_now", reason: "Nobody has replied to this enquiry yet." };
      if (last.direction === "inbound") return { action: "reply_now", reason: "The customer sent the most recent message." };
      return { action: "wait_for_customer", reason: "You sent the most recent message; give the customer time to reply." };
    }
  }
}

/** Drop the middle paragraph(s), keeping greeting, first point and sign-off. */
function squeeze(body: string) {
  const parts = body.split(/\n{2,}/);
  return parts.length > 3 ? [parts[0], parts[1], parts[parts.length - 1]].join("\n\n") : body;
}
