import type { Variant } from "@/lib/design/compose";
import type { DesignCopy, StockPhoto } from "@/lib/design/engine";

// TEMPORARY: briefs modelled on the user's reference flyers, for the dev gallery only.

const blank: Omit<DesignCopy, "headline"> = {
  brand: null, eyebrow: null, emphasis: null, subhead: null, bodyTitle: null, body: null,
  bullets: [], features: [], details: [], cta: null,
  contact: { phone: null, email: null, website: null, address: null, social: [] },
};

const pic = (seed: string, w = 1200, h = 1500): StockPhoto => ({
  url: `https://picsum.photos/seed/${seed}/${w}/${h}`,
  width: w,
  height: h,
  credit: { name: "Lorem Picsum", url: "https://picsum.photos" },
});

export interface Fixture {
  name: string;
  copy: DesignCopy;
  variant: Variant;
  photos: StockPhoto[];
}

export const FIXTURES: Fixture[] = [
  {
    name: "Corporate (ozio)",
    variant: { archetype: "editorial-split", palette: "trust-blue", pairing: "editorial" },
    photos: [pic("portrait-man", 1000, 1000)],
    copy: {
      ...blank,
      brand: "ozio",
      headline: "Boost Productivity and Profit.",
      emphasis: "Profit.",
      subhead: "with our Expertise.",
      bodyTitle: "Why should you pick us?",
      body: "At our core, we are committed to delivering results. We don't just provide advice; we implement strategies and measure success.",
      bullets: ["Executive Coaching", "Risk Management", "Innovative Solutions"],
      features: [
        { title: "Strategic Planning", text: "Developing long-term business strategies to achieve growth and profitability.", icon: "lightbulb" },
        { title: "Market Research", text: "Analyzing market trends, customer behavior, and competition.", icon: "search" },
        { title: "Financial Analysis", text: "Reviewing financial data to optimize budgeting and reduce costs.", icon: "bar-chart" },
      ],
      cta: "Call us now",
      contact: { phone: "800.123.4567", email: "sale@ozio.com", website: "www.ozio.com", address: "7124 Main Street, Suite 456, New York, NY 10001", social: ["@ozio"] },
    },
  },
  {
    name: "Healthcare recruitment",
    variant: { archetype: "bold-stack", palette: "clinical-red", pairing: "impact" },
    photos: [pic("nurses-team", 900, 1200), pic("nurse-mask", 900, 1200), pic("doctors", 900, 1200)],
    copy: {
      ...blank,
      brand: "Serenity Health",
      eyebrow: "Find your",
      headline: "Dream Job in Healthcare Industry",
      emphasis: "Dream",
      cta: "Contact us",
      features: [{ title: "Care", text: "", icon: "stethoscope" }],
      contact: { phone: "248-828-6562", email: null, website: "www.serenityhealthtraining.com", address: null, social: ["serenityhealthtraining10"] },
    },
  },
  {
    name: "Thanksgiving",
    variant: { archetype: "photo-overlay", palette: "harvest-gold", pairing: "elegant" },
    photos: [pic("thanksgiving-dinner", 1400, 1900)],
    copy: {
      ...blank,
      brand: "Company Name",
      eyebrow: "Happy",
      headline: "Thanksgiving",
      subhead: "special offer",
      body: "Gather around our table for a three-course harvest feast.",
      contact: { ...blank.contact, website: "companyname.web" },
    },
  },
  {
    name: "Business brochure",
    variant: { archetype: "geometric-split", palette: "noir-mono", pairing: "geometric" },
    photos: [pic("city-skyline", 1000, 1000), pic("city-river", 1000, 1000), pic("city-park", 1000, 1000), pic("city-tower", 1000, 1000)],
    copy: {
      ...blank,
      brand: "Company Name",
      bodyTitle: "Our mission",
      body: "We help growing companies turn complex problems into clear plans — from strategy through delivery — with a team that stays until the work is done.",
      headline: "Solutions for your business",
      subhead: "Strategy · Design · Delivery",
      bullets: ["Strategy workshops", "Brand systems", "Digital products"],
      contact: { phone: "+1 555 0134", email: "hello@company.com", website: "www.company.com", address: null, social: [] },
    },
  },
  {
    name: "Weekend sale",
    variant: { archetype: "swiss-type", palette: "hot-sale", pairing: "impact" },
    photos: [],
    copy: {
      ...blank,
      brand: "Juniper & Co.",
      eyebrow: "This weekend only",
      headline: "50% Off Everything",
      emphasis: "50%",
      subhead: "Our biggest sale of the year, in store and online.",
      details: [
        { icon: "calendar", text: "Saturday & Sunday, 10am – 8pm" },
        { icon: "map-pin", text: "12 Market Street" },
        { icon: "tag", text: "No code needed" },
      ],
      cta: "Shop now",
      contact: { ...blank.contact, website: "juniper.co" },
    },
  },
];
