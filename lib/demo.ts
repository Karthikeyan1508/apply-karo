import type { Session, Slot, SlotUpdate } from "./types"

const slot = (name: string, ask: string): Slot => ({
  name,
  ask,
  value: null,
  quote: null,
  skipped: false,
  fromProfile: false,
})

export type Lang = "en-IN" | "hi-IN"

interface FieldCopy {
  label: string
  intent: string
  /** One spoken question per slot, in the order of FIELDS[n].slots. */
  asks: string[]
}

/** Everything about the form that does not depend on the language. */
const FIELDS = [
  { kind: "text", required: true, maxChars: null, slots: ["name"] },
  { kind: "text", required: true, maxChars: null, slots: ["city"] },
  { kind: "long_text", required: true, maxChars: 600, slots: ["what", "own_part", "users", "outcome", "number"] },
  { kind: "long_text", required: false, maxChars: 400, slots: ["achievement", "impact"] },
  { kind: "long_text", required: false, maxChars: 500, slots: ["situation", "action", "result"] },
  { kind: "long_text", required: true, maxChars: 400, slots: ["motivation", "fit"] },
] as const

const COPY: Record<Lang, { title: string; description: string; fields: FieldCopy[] }> = {
  "en-IN": {
    title: "Product Engineer, Aurora Labs",
    description: "Demo application form",
    fields: [
      { label: "Full name", intent: "Identify the applicant", asks: ["What's your full name?"] },
      {
        label: "Where are you based?",
        intent: "Know the applicant's location for logistics",
        asks: ["Which city are you in?"],
      },
      {
        label: "Tell us about something you've built",
        intent: "Proof of ownership and measurable impact",
        asks: [
          "What did you build?",
          "Which part did you personally own?",
          "Who used it?",
          "What changed because of it?",
          "Is there a number we can include?",
        ],
      },
      {
        label: "What is your proudest achievement so far?",
        intent: "What the applicant values, with evidence",
        asks: ["What are you proudest of?", "What did it change for you or others?"],
      },
      {
        label: "Describe a time you led others",
        intent: "Leadership through concrete action and results",
        asks: ["Who were you leading, and on what?", "What did you do as the lead?", "How did it turn out?"],
      },
      {
        label: "Why this role?",
        intent: "Motivation and fit",
        asks: ["What draws you to this role?", "What makes you a fit for it?"],
      },
    ],
  },
  "hi-IN": {
    title: "प्रोडक्ट इंजीनियर, ऑरोरा लैब्स",
    description: "डेमो आवेदन फ़ॉर्म",
    fields: [
      { label: "पूरा नाम", intent: "आवेदक की पहचान", asks: ["आपका पूरा नाम क्या है?"] },
      {
        label: "आप कहाँ रहते हैं?",
        intent: "आवेदक का शहर जानना",
        asks: ["आप किस शहर में हैं?"],
      },
      {
        label: "कोई ऐसी चीज़ बताइए जो आपने बनाई है",
        intent: "आवेदक का अपना योगदान और उसका नापने लायक असर",
        asks: [
          "आपने क्या बनाया?",
          "इसमें आपका अपना हिस्सा कौन-सा था?",
          "इसे किसने इस्तेमाल किया?",
          "इसकी वजह से क्या बदला?",
          "क्या कोई संख्या बता सकते हैं?",
        ],
      },
      {
        label: "अब तक की आपकी सबसे बड़ी उपलब्धि क्या है?",
        intent: "आवेदक किसकी कद्र करता है, सबूत के साथ",
        asks: ["आपको किस पर सबसे ज़्यादा गर्व है?", "इससे आपके या दूसरों के लिए क्या बदला?"],
      },
      {
        label: "कोई ऐसा समय बताइए जब आपने दूसरों का नेतृत्व किया",
        intent: "ठोस काम और नतीजों के ज़रिए नेतृत्व",
        asks: [
          "आप किसे और किस काम में लीड कर रहे थे?",
          "लीड के तौर पर आपने क्या किया?",
          "नतीजा क्या रहा?",
        ],
      },
      {
        label: "यह भूमिका क्यों?",
        intent: "प्रेरणा और फ़िट",
        asks: ["इस भूमिका की ओर आपको क्या खींचता है?", "आप इसके लिए सही क्यों हैं?"],
      },
    ],
  },
}

/** A realistic job application, ready without any API key. Hindi has its own copy of every question. */
export function demoSession(lang: Lang = "en-IN"): Session {
  const copy = COPY[lang]
  return {
    id: "demo",
    title: copy.title,
    description: copy.description,
    source: "demo",
    formUrl: null,
    context: "",
    lang,
    fields: FIELDS.map((f, i) => ({
      id: `F${i + 1}`,
      index: i,
      entryId: null,
      label: copy.fields[i].label,
      kind: f.kind,
      options: [],
      multi: false,
      required: f.required,
      intent: copy.fields[i].intent,
      maxChars: f.maxChars,
      slots: f.slots.map((name, n) => slot(name, copy.fields[i].asks[n])),
      draft: "",
      draftSig: "",
      edited: false,
      flags: [],
    })),
  }
}

export type DemoStep =
  | { kind: "agent"; text: string }
  | { kind: "user"; text: string }
  | { kind: "tools"; updates: SlotUpdate[] }
  | { kind: "finish" }

/**
 * A scripted interview. Every quote is a substring of what the user said, except one
 * on purpose: the agent tries to record a number nobody said, and the guard blocks it.
 */
export const DEMO_STEPS: DemoStep[] = [
  {
    kind: "agent",
    text: "Hi! I'll help you fill in the Aurora Labs application. Nothing gets submitted without your OK. What's your full name?",
  },
  { kind: "user", text: "Hi, I'm Asha Patil, based in Pune." },
  {
    kind: "tools",
    updates: [
      { field: "F1", slot: "name", value: "Asha Patil", quote: "Asha Patil" },
      { field: "F2", slot: "city", value: "Pune", quote: "based in Pune" },
    ],
  },
  {
    kind: "agent",
    text: "Nice to meet you, Asha. Tell me about something you've built.",
  },
  { kind: "user", text: "I built a chatbot." },
  {
    kind: "tools",
    updates: [
      { field: "F3", slot: "what", value: "A chatbot", quote: "I built a chatbot" },
    ],
  },
  { kind: "agent", text: "A chatbot for whom, and what did it do?" },
  {
    kind: "user",
    text: "It was a WhatsApp ordering bot for kirana stores in Pune, so shop owners could take orders without writing anything down.",
  },
  {
    kind: "tools",
    updates: [
      {
        field: "F3",
        slot: "what",
        value: "A WhatsApp ordering bot for kirana stores in Pune",
        quote: "WhatsApp ordering bot for kirana stores in Pune",
      },
    ],
  },
  { kind: "agent", text: "Got it. Which part did you personally own?" },
  {
    kind: "user",
    text: "I wrote the whole order parsing backend myself, in Python. Two interns helped with the UI.",
  },
  {
    kind: "tools",
    updates: [
      {
        field: "F3",
        slot: "own_part",
        value: "Wrote the order-parsing backend in Python",
        quote: "wrote the whole order parsing backend myself, in Python",
      },
      {
        field: "F5",
        slot: "situation",
        value: "Worked with two interns on the UI",
        quote: "Two interns helped with the UI",
      },
    ],
  },
  {
    kind: "agent",
    text: "Who ended up using it, and what changed for them?",
  },
  {
    kind: "user",
    text: "About thirty shop owners use it. Taking an order went from six minutes to one.",
  },
  {
    kind: "tools",
    updates: [
      {
        field: "F3",
        slot: "users",
        value: "About 30 shop owners",
        quote: "About thirty shop owners use it",
      },
      {
        field: "F3",
        slot: "outcome",
        value: "Order-taking time cut from 6 minutes to 1",
        quote: "went from six minutes to one",
      },
      // The guard blocks this one: the user never said it.
      {
        field: "F3",
        slot: "number",
        value: "90,000 users",
        quote: "ninety thousand users",
      },
    ],
  },
  {
    kind: "agent",
    text: "One more detail. Is there a number I can put on the form, like orders a week?",
  },
  { kind: "user", text: "Yeah, about four hundred orders a week." },
  {
    kind: "tools",
    updates: [
      {
        field: "F3",
        slot: "number",
        value: "About 400 orders a week",
        quote: "four hundred orders a week",
      },
    ],
  },
  { kind: "agent", text: "Great. What's your proudest achievement so far?" },
  {
    kind: "user",
    text: "Winning the college innovation award in 2025 for that bot.",
  },
  {
    kind: "tools",
    updates: [
      {
        field: "F4",
        slot: "achievement",
        value: "Won the college innovation award (2025) for the bot",
        quote: "Winning the college innovation award in 2025",
      },
    ],
  },
  { kind: "agent", text: "And what did that change for you?" },
  { kind: "user", text: "Honestly, not much. I'd rather skip that one." },
  {
    kind: "tools",
    updates: [{ field: "F4", slot: "impact", skip: true }],
  },
  {
    kind: "agent",
    text: "You mentioned two interns. What did you do as their lead, and how did it turn out?",
  },
  {
    kind: "user",
    text: "I split the UI into two parts, reviewed their pull requests every day, and we shipped in eight weeks.",
  },
  {
    kind: "tools",
    updates: [
      {
        field: "F5",
        slot: "action",
        value: "Split the UI work between two interns and reviewed their pull requests daily",
        quote: "reviewed their pull requests every day",
      },
      {
        field: "F5",
        slot: "result",
        value: "Shipped in 8 weeks",
        quote: "we shipped in eight weeks",
      },
    ],
  },
  { kind: "agent", text: "Last one. Why this role?" },
  {
    kind: "user",
    text: "I like fintech problems for small businesses, and I've already built for them.",
  },
  {
    kind: "tools",
    updates: [
      {
        field: "F6",
        slot: "motivation",
        value: "Interest in fintech problems for small businesses",
        quote: "I like fintech problems for small businesses",
      },
      {
        field: "F6",
        slot: "fit",
        value: "Has already built for small businesses",
        quote: "I've already built for them",
      },
    ],
  },
  {
    kind: "agent",
    text: "Let me read that back. You built a WhatsApp ordering bot for kirana stores in Pune, you wrote the backend, about thirty shop owners use it, and it handles about four hundred orders a week. Is that right?",
  },
  { kind: "user", text: "Yes, that's right." },
  { kind: "finish" },
]

/**
 * The same interview in Hindi. Every quote is a substring of the user's line before it, except the
 * one the guard is meant to block. Numbers are spoken as words and recorded as digits.
 */
export const DEMO_STEPS_HI: DemoStep[] = [
  {
    kind: "agent",
    text: "नमस्ते! प्रोडक्ट इंजीनियर, ऑरोरा लैब्स का आवेदन भरने में मैं आपकी मदद के लिए हूँ। आपकी मंज़ूरी के बिना कुछ भी जमा नहीं होगा। आपका पूरा नाम क्या है?",
  },
  { kind: "user", text: "नमस्ते, मैं आशा पाटिल हूँ, पुणे में रहती हूँ।" },
  {
    kind: "tools",
    updates: [
      { field: "F1", slot: "name", value: "आशा पाटिल", quote: "आशा पाटिल" },
      { field: "F2", slot: "city", value: "पुणे", quote: "पुणे में रहती हूँ" },
    ],
  },
  { kind: "agent", text: "धन्यवाद आशा जी। अब बताइए, आपने ऐसा क्या बनाया है जिस पर आपको गर्व हो?" },
  { kind: "user", text: "मैंने एक चैटबॉट बनाया था।" },
  {
    kind: "tools",
    updates: [{ field: "F3", slot: "what", value: "एक चैटबॉट", quote: "मैंने एक चैटबॉट बनाया था" }],
  },
  { kind: "agent", text: "किसके लिए, और वह क्या करता था?" },
  {
    kind: "user",
    text: "वह पुणे की किराना दुकानों के लिए एक व्हाट्सऐप ऑर्डरिंग बॉट था, ताकि दुकानदार बिना कुछ लिखे ऑर्डर ले सकें।",
  },
  {
    kind: "tools",
    updates: [
      {
        field: "F3",
        slot: "what",
        value: "पुणे की किराना दुकानों के लिए व्हाट्सऐप ऑर्डरिंग बॉट",
        quote: "पुणे की किराना दुकानों के लिए एक व्हाट्सऐप ऑर्डरिंग बॉट था",
      },
    ],
  },
  { kind: "agent", text: "अच्छा। इसमें आपका अपना हिस्सा कौन-सा था?" },
  {
    kind: "user",
    text: "पूरा ऑर्डर पार्सिंग बैकएंड मैंने खुद पाइथन में लिखा। यूआई में दो इंटर्न ने मदद की।",
  },
  {
    kind: "tools",
    updates: [
      {
        field: "F3",
        slot: "own_part",
        value: "ऑर्डर पार्सिंग का पूरा बैकएंड पाइथन में लिखा",
        quote: "पूरा ऑर्डर पार्सिंग बैकएंड मैंने खुद पाइथन में लिखा",
      },
      {
        field: "F5",
        slot: "situation",
        value: "यूआई पर दो इंटर्न के साथ काम किया",
        quote: "यूआई में दो इंटर्न ने मदद की",
      },
    ],
  },
  { kind: "agent", text: "इसे किन लोगों ने इस्तेमाल किया, और उनके लिए क्या बदला?" },
  {
    kind: "user",
    text: "करीब तीस दुकानदार इस्तेमाल करते हैं। एक ऑर्डर लेने में छह मिनट लगते थे, अब एक मिनट लगता है।",
  },
  {
    kind: "tools",
    updates: [
      {
        field: "F3",
        slot: "users",
        value: "करीब 30 दुकानदार",
        quote: "करीब तीस दुकानदार इस्तेमाल करते हैं",
      },
      {
        field: "F3",
        slot: "outcome",
        value: "एक ऑर्डर लेने का समय 6 मिनट से घटकर 1 मिनट रह गया",
        quote: "छह मिनट लगते थे, अब एक मिनट लगता है",
      },
      // The guard blocks this one: the user never said it.
      { field: "F3", slot: "number", value: "90,000 यूज़र", quote: "नब्बे हज़ार यूज़र" },
    ],
  },
  { kind: "agent", text: "एक बात और। क्या कोई संख्या फ़ॉर्म में लिख दूँ, जैसे हफ़्ते में कितने ऑर्डर?" },
  { kind: "user", text: "हाँ, हफ़्ते में लगभग चार सौ ऑर्डर आते हैं।" },
  {
    kind: "tools",
    updates: [
      {
        field: "F3",
        slot: "number",
        value: "हफ़्ते में लगभग 400 ऑर्डर",
        quote: "हफ़्ते में लगभग चार सौ ऑर्डर आते हैं",
      },
    ],
  },
  { kind: "agent", text: "बढ़िया। अब तक की आपकी सबसे बड़ी उपलब्धि क्या है?" },
  { kind: "user", text: "2025 में उस बॉट के लिए कॉलेज का इनोवेशन अवॉर्ड जीता।" },
  {
    kind: "tools",
    updates: [
      {
        field: "F4",
        slot: "achievement",
        value: "उस बॉट के लिए कॉलेज का इनोवेशन अवॉर्ड (2025)",
        quote: "2025 में उस बॉट के लिए कॉलेज का इनोवेशन अवॉर्ड जीता",
      },
    ],
  },
  { kind: "agent", text: "और इससे आपके लिए क्या बदला?" },
  { kind: "user", text: "सच कहूँ तो ज़्यादा कुछ नहीं। इसे छोड़ देते हैं।" },
  { kind: "tools", updates: [{ field: "F4", slot: "impact", skip: true }] },
  {
    kind: "agent",
    text: "आपने दो इंटर्न का ज़िक्र किया। उनके लीड के तौर पर आपने क्या किया, और नतीजा क्या रहा?",
  },
  {
    kind: "user",
    text: "मैंने यूआई को दो हिस्सों में बाँटा, रोज़ उनके पुल रिक्वेस्ट रिव्यू किए, और हमने आठ हफ़्तों में शिप कर दिया।",
  },
  {
    kind: "tools",
    updates: [
      {
        field: "F5",
        slot: "action",
        value: "यूआई का काम दो इंटर्न में बाँटा और रोज़ उनके पुल रिक्वेस्ट रिव्यू किए",
        quote: "रोज़ उनके पुल रिक्वेस्ट रिव्यू किए",
      },
      {
        field: "F5",
        slot: "result",
        value: "8 हफ़्तों में शिप किया",
        quote: "हमने आठ हफ़्तों में शिप कर दिया",
      },
    ],
  },
  { kind: "agent", text: "आख़िरी सवाल। यह भूमिका क्यों?" },
  {
    kind: "user",
    text: "मुझे छोटे बिज़नेस के फिनटेक प्रॉब्लम्स पसंद हैं, और मैं उनके लिए पहले ही बना चुकी हूँ।",
  },
  {
    kind: "tools",
    updates: [
      {
        field: "F6",
        slot: "motivation",
        value: "छोटे बिज़नेस के फिनटेक प्रॉब्लम्स में दिलचस्पी",
        quote: "मुझे छोटे बिज़नेस के फिनटेक प्रॉब्लम्स पसंद हैं",
      },
      {
        field: "F6",
        slot: "fit",
        value: "छोटे बिज़नेस के लिए पहले ही बना चुकी हैं",
        quote: "उनके लिए पहले ही बना चुकी हूँ",
      },
    ],
  },
  {
    kind: "agent",
    text: "ज़रा दोहरा लेते हैं। आपने पुणे की किराना दुकानों के लिए व्हाट्सऐप ऑर्डरिंग बॉट बनाया, बैकएंड आपने लिखा, करीब तीस दुकानदार इस्तेमाल करते हैं और हफ़्ते में लगभग चार सौ ऑर्डर आते हैं। क्या यह सही है?",
  },
  { kind: "user", text: "हाँ, बिल्कुल सही।" },
  { kind: "finish" },
]

/** The scripted interview for a language. */
export const demoSteps = (lang: Lang, id?: string): DemoStep[] =>
  id === MERCHANT_ID ? MERCHANT_STEPS : lang === "hi-IN" ? DEMO_STEPS_HI : DEMO_STEPS

/**
 * Finished answers for the scripted interview, used only by the recorded replay so it needs no
 * network. Each one uses only what the scripted user said: the tests check it raises no flags.
 */
export const DEMO_DRAFTS: Record<Lang, Record<string, string>> = {
  "en-IN": {
    F1: "Asha Patil",
    F2: "Pune",
    F3: "I built a WhatsApp ordering bot for kirana stores in Pune and wrote the order-parsing backend myself, in Python. About 30 shop owners use it, and taking an order now takes 1 minute instead of 6. It handles about 400 orders a week.",
    F4: "I won the college innovation award in 2025 for the WhatsApp ordering bot.",
    F5: "I led two interns on the UI of the ordering bot. I split the work between them and reviewed their pull requests every day. We shipped in 8 weeks.",
    F6: "I like fintech problems for small businesses, and I've already built for them.",
  },
  "hi-IN": {
    F1: "आशा पाटिल",
    F2: "पुणे",
    F3: "मैंने पुणे की किराना दुकानों के लिए व्हाट्सऐप ऑर्डरिंग बॉट बनाया और ऑर्डर पार्सिंग का पूरा बैकएंड पाइथन में खुद लिखा। करीब 30 दुकानदार इसे इस्तेमाल करते हैं, एक ऑर्डर लेने में अब 6 मिनट की जगह 1 मिनट लगता है, और हफ़्ते में लगभग 400 ऑर्डर आते हैं।",
    F4: "मैंने उस बॉट के लिए 2025 में कॉलेज का इनोवेशन अवॉर्ड जीता।",
    F5: "मैंने यूआई पर दो इंटर्न को लीड किया: काम उनमें बाँटा और रोज़ उनके पुल रिक्वेस्ट रिव्यू किए। हमने 8 हफ़्तों में शिप कर दिया।",
    F6: "मुझे छोटे बिज़नेस के फिनटेक प्रॉब्लम्स पसंद हैं, और मैं उनके लिए पहले ही बना चुकी हूँ।",
  },
}

/**
 * The recorded-fallback flag: `/?replay=1` replays the scripted interview with captions and no network.
 * Add `&lang=hi` for the Hindi form and `&speed=2` for double speed.
 */
export function parseReplay(search: string): { lang: Lang; speed: 1 | 2 } | null {
  const q = new URLSearchParams(search)
  if (!q.has("replay") || q.get("replay") === "0") return null
  return { lang: q.get("lang") === "hi" ? "hi-IN" : "en-IN", speed: q.get("speed") === "2" ? 2 : 1 }
}

// ---------- A second demo: a kirana owner's loan application, spoken in Hindi and English words ----------

export const MERCHANT_ID = "demo-merchant"

/** Form questions stay in English, as a lender's form would be. The interview is in Hindi. */
const MERCHANT_FIELDS = [
  { label: "Owner's full name", intent: "Identify the applicant", kind: "text", required: true, maxChars: null, slots: [["name", "आपका पूरा नाम क्या है?"]] },
  { label: "Shop name and type", intent: "What kind of business this is", kind: "text", required: true, maxChars: null, slots: [["shop", "आपकी दुकान का नाम क्या है, और वह किस तरह की दुकान है?"]] },
  {
    label: "Tell us about your business",
    intent: "How established the business is, and how big in rupees",
    kind: "long_text",
    required: true,
    maxChars: 500,
    slots: [
      ["sells", "आप क्या बेचते हैं?"],
      ["years", "दुकान कितने साल से चल रही है?"],
      ["daily_sales", "रोज़ की बिक्री लगभग कितनी होती है?"],
      ["customers", "ज़्यादातर ग्राहक कौन हैं?"],
    ],
  },
  {
    label: "How much do you need, and what for?",
    intent: "The loan size, what it is for, and what the owner can repay",
    kind: "long_text",
    required: true,
    maxChars: 500,
    slots: [
      ["amount", "आपको कितने रुपये का लोन चाहिए?"],
      ["purpose", "यह पैसा किस काम में लगाएँगे?"],
      ["repay", "हर महीने कितनी किस्त दे पाएँगे?"],
    ],
  },
  { label: "Any existing loans or dues?", intent: "Existing debt that affects repayment", kind: "long_text", required: false, maxChars: 300, slots: [["existing", "क्या कोई और लोन या उधारी चल रही है?"]] },
  { label: "City and area", intent: "Where the shop is", kind: "text", required: true, maxChars: null, slots: [["city", "दुकान किस शहर और इलाके में है?"]] },
] as const

export function merchantSession(): Session {
  return {
    id: MERCHANT_ID,
    title: "Merchant working-capital loan",
    description: "Demo merchant loan form",
    source: "demo",
    formUrl: null,
    context: "",
    lang: "hi-IN",
    fields: MERCHANT_FIELDS.map((f, i) => ({
      id: `F${i + 1}`,
      index: i,
      entryId: null,
      label: f.label,
      kind: f.kind,
      options: [],
      multi: false,
      required: f.required,
      intent: f.intent,
      maxChars: f.maxChars,
      slots: f.slots.map(([name, ask]) => slot(name, ask)),
      draft: "",
      draftSig: "",
      edited: false,
      flags: [],
    })),
  }
}

/**
 * The scripted merchant interview. Every quote is a substring of the user's line before it, except the
 * one the guard is meant to block: the agent tries to record a sales figure nobody said.
 */
export const MERCHANT_STEPS: DemoStep[] = [
  {
    kind: "agent",
    text: "नमस्ते! Merchant working-capital loan का फ़ॉर्म भरने में मैं आपकी मदद के लिए हूँ। आपकी मंज़ूरी के बिना कुछ भी जमा नहीं होगा। आपका पूरा नाम क्या है?",
  },
  {
    kind: "user",
    text: "नमस्ते, मेरा नाम रमेश गुप्ता है। मेरी किराना की दुकान है, गुप्ता जनरल स्टोर, हड़पसर में।",
  },
  {
    kind: "tools",
    updates: [
      { field: "F1", slot: "name", value: "रमेश गुप्ता", quote: "रमेश गुप्ता" },
      { field: "F2", slot: "shop", value: "गुप्ता जनरल स्टोर, किराना दुकान", quote: "गुप्ता जनरल स्टोर" },
      { field: "F6", slot: "city", value: "हड़पसर", quote: "हड़पसर में" },
    ],
  },
  { kind: "agent", text: "धन्यवाद रमेश जी। दुकान में आप क्या बेचते हैं, और यह कितने साल से चल रही है?" },
  { kind: "user", text: "रोज़मर्रा का राशन, दूध और स्नैक्स बेचता हूँ। दुकान बारह साल से चल रही है।" },
  {
    kind: "tools",
    updates: [
      {
        field: "F3",
        slot: "sells",
        value: "रोज़मर्रा का राशन, दूध और स्नैक्स",
        quote: "रोज़मर्रा का राशन, दूध और स्नैक्स बेचता हूँ",
      },
      { field: "F3", slot: "years", value: "12 साल", quote: "दुकान बारह साल से चल रही है" },
    ],
  },
  { kind: "agent", text: "रोज़ की बिक्री लगभग कितनी हो जाती है, और ज़्यादातर ग्राहक कौन हैं?" },
  { kind: "user", text: "बिक्री ठीक-ठाक है, आसपास की कॉलोनी के लोग आते हैं।" },
  {
    kind: "tools",
    updates: [
      {
        field: "F3",
        slot: "customers",
        value: "आसपास की कॉलोनी के लोग",
        quote: "आसपास की कॉलोनी के लोग आते हैं",
      },
      // The guard blocks this one: the user never said a figure.
      { field: "F3", slot: "daily_sales", value: "₹50,000", quote: "पचास हज़ार रुपये" },
    ],
  },
  { kind: "agent", text: "रोज़ की बिक्री का कोई अंदाज़ा बता सकते हैं, जैसे कितने रुपये?" },
  { kind: "user", text: "रोज़ की बिक्री लगभग पंद्रह हज़ार रुपये हो जाती है।" },
  {
    kind: "tools",
    updates: [
      {
        field: "F3",
        slot: "daily_sales",
        value: "लगभग ₹15,000 रोज़",
        quote: "रोज़ की बिक्री लगभग पंद्रह हज़ार रुपये हो जाती है",
      },
    ],
  },
  { kind: "agent", text: "बहुत बढ़िया। अब बताइए, आपको कितने रुपये का लोन चाहिए, और पैसा किस काम में लगाएँगे?" },
  { kind: "user", text: "मुझे दो लाख रुपये का लोन चाहिए। उससे फ्रिज और ज़्यादा माल खरीदना है।" },
  {
    kind: "tools",
    updates: [
      { field: "F4", slot: "amount", value: "₹2,00,000", quote: "दो लाख रुपये का लोन चाहिए" },
      { field: "F4", slot: "purpose", value: "फ्रिज और ज़्यादा माल खरीदना", quote: "फ्रिज और ज़्यादा माल खरीदना है" },
    ],
  },
  { kind: "agent", text: "हर महीने कितनी किस्त दे पाएँगे, और क्या कोई और लोन चल रहा है?" },
  { kind: "user", text: "महीने में आठ हज़ार रुपये की किस्त दे सकता हूँ। कोई और लोन नहीं है।" },
  {
    kind: "tools",
    updates: [
      { field: "F4", slot: "repay", value: "₹8,000 महीना", quote: "महीने में आठ हज़ार रुपये की किस्त दे सकता हूँ" },
      { field: "F5", slot: "existing", value: "कोई और लोन नहीं", quote: "कोई और लोन नहीं है" },
    ],
  },
  {
    kind: "agent",
    text: "ज़रा दोहरा लेते हैं। गुप्ता जनरल स्टोर, हड़पसर, बारह साल पुरानी किराना दुकान, रोज़ की बिक्री लगभग पंद्रह हज़ार रुपये। आपको दो लाख रुपये का लोन चाहिए, फ्रिज और माल के लिए, महीने की किस्त आठ हज़ार रुपये। क्या यह सही है?",
  },
  { kind: "user", text: "हाँ, बिल्कुल सही है।" },
  { kind: "finish" },
]
