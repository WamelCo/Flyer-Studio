/**
 * Real-world scenarios: Zimbabwean small-business owners, written the way they would type
 * them into the app (fictional businesses and numbers). Shared by the simulation scripts.
 */
import type { FlyerFormat } from "../src/canvas/types";

export interface Scenario {
  id: string;
  owner: string;
  prompt: string;
  /** WhatsApp status (story) and group posts (square) are the main channels; poster = print. */
  format: FlyerFormat;
}

export const ZW_SCENARIOS: Scenario[] = [
  {
    id: "salon",
    owner: "Rudo, hair salon owner, Avondale, Harare",
    prompt: "Knotless braids special at Rudo's Hair Studio this December, US$25 any length, Avondale Shops Harare, WhatsApp 0772 145 682",
    format: "story",
  },
  {
    id: "solar",
    owner: "Themba, solar installer, Bulawayo",
    prompt: "Beat load shedding with Sunlink Solar Bulawayo, 3kVA home systems from US$1,200 installed, free site assessment, call 0712 330 918",
    format: "poster",
  },
  {
    id: "kitchen",
    owner: "Mai Tino, takeaway kitchen, Mbare",
    prompt: "Mai Tino's Kitchen in Mbare, sadza and beef stew US$3, chicken and rice US$4, open Monday to Saturday, orders on WhatsApp 0783 441 207",
    format: "square",
  },
  {
    id: "driving",
    owner: "Mr Moyo, driving school, Gweru",
    prompt: "Gweru Defensive Driving School, class 4 lessons and provisional licence classes every Saturday at 9am, enrol now, 0773 902 114",
    format: "poster",
  },
  {
    id: "crusade",
    owner: "Pastor Chari, church outreach, Chitungwiza",
    prompt: "Revival crusade at Zengeza 3 grounds, Chitungwiza, Saturday 14 March from 2pm, all are welcome, free entry",
    format: "poster",
  },
  {
    id: "chicks",
    owner: "Farai, poultry and agro supplies, Chitungwiza",
    prompt: "Day-old broiler chicks now available at Murombedzi Agro, US$1 per chick, free delivery in Chitungwiza for 50 chicks or more, WhatsApp 0783 552 019",
    format: "square",
  },
  {
    id: "school",
    owner: "Mrs Ncube, private school, Mutare",
    prompt: "Enrolling now for ECD and Form 1 2027 at Mutare Christian Academy, boarding and day places, call 020 2061 345",
    format: "poster",
  },
  {
    id: "phones",
    owner: "Tapiwa, phone repairs, Harare CBD",
    prompt: "Cracked screen? Phone screen repairs in 1 hour at FixIt Mobile, iPhone and Samsung, Copacabana rank Harare CBD, WhatsApp 0719 553 802",
    format: "square",
  },
  {
    id: "grocery",
    owner: "Mr Dube, supermarket, Epworth",
    prompt: "Back to school specials at Pamuzinda Supermarket Epworth, 2kg sugar US$2.50, 10kg mealie meal US$6, 2 litre cooking oil ZiG 95",
    format: "poster",
  },
  {
    id: "hardware",
    owner: "Kuda, hardware store, Norton",
    prompt: "Building this season? Cement US$9.50 per bag at BuildRite Hardware Norton, roofing sheets and river sand in stock, delivery available, 0774 210 663",
    format: "story",
  },
];
