# ShopShip — Legal review before launch

Drafted 2026-11-17 by Praewa (AI legal research, NOT a licensed attorney). Pages: `/legal/privacy`, `/legal/cookies`,
`/legal/terms`, `/legal/returns`, `/legal/shipping` (source: `web/src/app/(site)/legal/`). Business identity placeholders
live in one place: `web/src/app/(site)/legal/_components/legal-doc.tsx` → `entity`. Every blank is `[...]`, rendered
highlighted (`<Fill>`). Before launch: search the legal folder for `[` and `<Fill>`, and there must be none left.

## A. Must be confirmed by a licensed Thai lawyer (and accountant where noted) BEFORE launch

- [ ] **Direct marketing registration with OCPB (สคบ.)** under the Direct Sales and Direct Marketing Act B.E. 2545 (amended B.E. 2560).
  - Online selling is "ตลาดแบบตรง" (direct marketing).
  - A ministerial-regulation exemption is reported for small sellers: individuals with online sales of 1.8 MB/year or less, and qualifying SMEs (กฎกระทรวง 2561). This is UNVERIFIED against the Royal Gazette.
  - Confirm whether the company must register, and fill `entity.ocpbNo` (or remove that line).
  - Operating unregistered is reported to carry a fine (an OCPB fine of 132,000 THB on an online shop was reported in Oct 2024).
- [ ] **DBD e-commerce registration** (ทะเบียนพาณิชย์อิเล็กทรอนิกส์ + DBD Registered mark): fill `entity.dbdNo` and show the mark in the footer.
- [ ] **Cooling-off wording** (`/legal/returns` §2). The draft uses 7 days from receipt, written notice (email treated as writing under the Electronic Transactions Act B.E. 2544), and refund within 15 days of the notice. The lawyer must confirm:
  - the current section numbers;
  - the consumer's return period and duty of care (news sources mention 21 days);
  - **who pays return shipping** (placeholder left);
  - whether the refund must include the original shipping fee (the draft says yes for a whole-order return);
  - the late-refund interest rule (one news source cites a rate, which I could not verify, so I left the rate out);
  - whether any **statutory exemption list** of goods exists. The draft has a placeholder only, and I found no verified exemption notification. Delete the box if none exists.
- [ ] **Watch the new Direct Sales/Direct Marketing bill.** OCPB is drafting a replacement Act (Thansettakij, 1 Nov 2026), which proposes:
  - a 14-day cancellation period;
  - a right to open and test goods;
  - platform liability;
  - a 180-day registration transition.

  It is still in public consultation. Re-check before launch and update `/legal/returns`.
- [ ] **Defect liability**: confirm the wording on seller liability under CCC ss.472–474 (1 year from discovery) and the Product Liability Act B.E. 2551. Also confirm that the 7-day reporting window for damage claims is advisory, not a bar.
- [ ] **Liability clause** (`/legal/terms` §13): confirm it is fair under the Unfair Contract Terms Act B.E. 2540, including s.8 (no exclusion of liability for death or bodily injury) and the Consumer Protection Act. Confirm the consumer-venue wording matches the Consumer Case Procedure Act B.E. 2551.
- [ ] **Price-error clause** (`/legal/terms` §3): confirm when the contract forms ("on successful payment + confirmation email"). Confirm the "obvious error → contact, buyer chooses correct price or full refund" approach.
- [ ] **VAT / tax invoices / e-Tax Invoice** (ACCOUNTANT).
  - Confirm VAT registration status. The footer and Terms say "ราคารวม VAT"; if the business is not VAT-registered, remove that.
  - Confirm when a full tax invoice must be issued and the e-Tax Invoice by email option.
  - Confirm the e-commerce income reporting duties.
  - Confirm the record-retention period. The draft says "generally at least 5 years" (Accounting Act B.E. 2543 / Revenue Code).
- [ ] **Cross-border transfer basis** (PDPA ss.28–29 + PDPC notifications effective 24 Mar 2024). Hosting is Railway (Singapore). Cloudflare, the email provider and the AI provider (probably US) also process data abroad.
  - Confirm which mechanism the business relies on for each vendor: vendor DPA/SCCs (ASEAN MCC or EU SCC-based clauses are reported as recognised) or the s.28 contract-performance exception.
  - Confirm whether SCCs need filing. Sources conflict on this.
  - A PDPC hearing on revised cross-border measures (Apr 2026) was reported. Check the outcome.
- [ ] **DPO requirement** (PDPA s.41): decide whether the core activities involve "regular and systematic monitoring on a large scale". Member tiers, purchase-history-based pricing and a possible marketing pixel make this arguable.
  - The PDPC fined a collectible-toy company for failing to appoint a DPO (Aug 2025).
  - If no DPO is appointed, replace `entity.dpo` with "ไม่มี — ติดต่อ <privacy email>".
- [ ] **Lawful bases table** (`/legal/privacy` §3): confirm that contract vs. legitimate-interest assignments are right. Confirm that a Legitimate Interest Assessment is on file for fraud prevention, reviews and logs.
- [ ] **Retention periods**: owner must fill these, lawyer must confirm. Check the 90-day traffic-data claim under the Computer-Related Crime Act (whether a single-shop site is a "service provider" for that rule).
- [ ] **AI chatbot**: confirm the disclosure wording, the AI vendor's data-use terms (no training, retention), and the transfer country before the bot is enabled in production.
- [ ] **Cookie consent**: confirm the banner matches the PDPC cookie guidance.
  - Non-essential cookies stay off by default, and "reject" is as easy as "accept".
  - Classifying `shopship_recent_search` (device-only local storage) as necessary needs confirmation.
- [ ] **Minors**: the draft says the service is for ages 20+ or with guardian consent, and that data from under-10s is deleted. Confirm against PDPA s.20.
- [ ] **Reviews / advertising**: confirm the wording on fake or incentivised reviews. Confirm category-specific advertising rules if the shop sells food, cosmetics or supplements (FDA approval numbers on product pages).
- [ ] **Member/trade programme terms**: fill the tier and wholesale eligibility criteria. Confirm the 30-day notice for changes.

## B. Owner must fill (placeholders on the pages)

- `entity` in `legal-doc.tsx`: company name, registration/tax ID, office and return addresses, customer-service email and phone, hours, privacy/DPO email, DPO name, DBD no., OCPB no.
- Privacy: AI provider name/country/data-use terms; email provider; Railway/Vercel (actual host); analytics/marketing tools (or delete the row); server region; retention numbers (30 days / 3 years / 1 year / 2 years / 90 days).
- Cookies: consent-cookie name and lifetime (from Nansy's banner); analytics/marketing cookie rows (or delete them).
- Terms: VAT statement; member/trade criteria; notice days; tax-invoice process; complaint response days.
- Returns: return address, return period, who pays return shipping, exemption list (or delete the box), damage-report window.
- Shipping: handling days.

## C. Product/engineering gaps the pages promise (must be true at launch)

- [ ] Footer "ตั้งค่าคุกกี้" (cookie settings) button reopens the banner (Nansy). Banner categories = necessary / analytics / marketing.
- [ ] Every marketing email has an unsubscribe link. Transactional emails include the receipt and tracking number.
- [ ] Account deletion / data export: currently by email request only. Track requests and answer within 30 days. A self-serve flow is recommended.
- [ ] Order confirmation email states the 7-day cancellation right and the business address (Direct Sales Act documentation duty: lawyer to confirm the required contents).
- [ ] The breach-response runbook exists (72-hour PDPC notification).
- [ ] Encrypt addresses/phones at rest (open item from schema review).
- [ ] Images on Cloudflare R2 (privacy page names Cloudflare; currently LocalDisk).

Praewa is an AI counsel, not a licensed attorney. This is legal research, not legal advice.
