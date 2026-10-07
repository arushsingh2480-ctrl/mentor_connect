# Mentor Connect AI — Rethink 26 Pitch Script (Team Parallax)
**~4 min speech + live demo.** Slow bolo, har point ke baad ek pause.

## 1. Hook (20 sec)
- "India mein 2.5 crore+ students exams dete hain — lekin sirf **23%** apna career khud soch-samajh ke chunte hain. **68%** parents ke pressure mein."
- "Sabse bade decision pe sabse kam guidance. Hum yahi gap fix karte hain."

## 2. Solution (30 sec)
- **Mentor Connect AI** = verified seniors/alumni (IIT, DTU, NSUT, DU) se **1-to-1 mentorship**.
- Teen pillars: **Verified** (AI + admin check) · **Personalized** (explainable matching) · **Practical** (book → chat → video call → roadmap).

## 3. Live Demo (2 min — 2 tabs: Student + Mentor)
1. **Student dashboard** → Career Readiness 64%.
2. **MentorAI** → dilemma likho → next steps + mentor se puchne ke 4 questions.
3. **Matching** → "94% match" pe click → score ka **reason** dikhta hai (black box nahi).
4. **Book slot** → same slot dobara → **"already reserved"** (double-booking blocked).
5. **Message Mentor** → mentor ki screen pe **turant** message (typing + online status).
6. **Video call** → "Launch Call" → mentor ko **incoming call popup** → Accept → live video, screen share, in-call chat.
7. Mentor **action item** add kare → student ke **roadmap mein turant save**.
8. **Admin** → verification queue → AI confidence → approve → ✓ Verified badge.

## 4. Tech edge (30 sec)
- React 19 + TypeScript + Express + **Socket.IO** + **WebRTC (P2P + TURN fallback)**.
- Matching **deterministic & explainable** (7 factors) — AI sirf guidance deta hai, score nahi.
- Gemini down ho to **rule-based fallback** — demo kabhi fail nahi hota.
- Secure: signed login tokens, chat/call rooms sirf participants ke liye.

## 5. Impact + Next (20 sec)
- Kam confusion · equal access · trusted guidance · roadmap se measurable progress.
- Next: MongoDB, real OCR, Hindi/regional languages, mobile app, payments.

## 6. Closing
- **"Guidance from someone who already walked your path."** Thank you!

---
## Judge Q&A (1 line each)
- **LinkedIn kyun nahi?** Cold messages ka response <5%, credentials unverified, roadmap + video built-in nahi.
- **AI ka role?** Career diagnosis + questions + document check. Match score 100% deterministic.
- **Fake mentor?** College email + ID + document → AI confidence → admin approval → tabhi Verified badge.
- **Double booking?** Server-side slot conflict check (409).
- **Alag networks pe call?** STUN + **TURN relay**; camera na ho to bhi audio/chat + dusre ko dekh sakte ho.
- **Data safe?** Signed tokens; chat sirf participants ko; call rooms authorize hote hain.
- **Monetize?** Payments + mentor payouts (next step).

## Demo se pehle (30 sec)
- `npm install && npm run dev` → http://localhost:3000
- **Do alag tabs**: ek Student, ek Mentor (DemoBar se switch). Har tab ka apna session hai.
- Camera permission "Allow". Dusre device pe demo ho to **https link** (ngrok/cloudflared) — http://IP pe browser camera block karta hai.
