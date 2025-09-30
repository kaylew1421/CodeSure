<<<<<<< HEAD
# Project Story: CodeSure – Chrome Extension for CPT Validation  

## Inspiration  
Claim denials waste time and money—often because codes or payer rules are misunderstood at the moment of entry. In this hackathon I set out to build a **lightweight, privacy-first** helper that lives in the browser and delivers **on-device intelligence** for fewer errors, faster approvals, and a calmer day for clinicians and billers.

## What it does  
CodeSure helps you go from service description → suggested codes → payer rules → prior-auth note in one flow:

- **AI Assist (Prompt API):** Type “CT abdomen with contrast” and get ranked suggestions from a local CPT-like mock catalog; attachments (filenames) act as hints.
- **Validate & Compare:** Select a payer to see rule text, or open a side-by-side payer table. Click “Explain rule” for a one-sentence rationale (Prompt API). Export CSV or copy as text.
- **Policy Summarizer (Summarizer API):** Summarize the open policy page into key points; Translator API renders outputs in EN/ES/JA. Falls back to Prompt API if Summarizer isn’t available.
- **PA Note Builder:** Structured fields (Medical Necessity, History/Imaging, Site/Modifiers) with AI drafts and minimal polishing, then assemble a clean plain-text PA note.
- **Coverage Snapshot:** One-click digest of payer rules plus top required docs inferred from your summary.
- **Diagnostics:** Built-in checks for models and data to keep demos reliable—even offline after warm-up.
- Demo uses **synthetic** 5-digit “CPT-like” codes and mock rules; no PHI; all AI runs locally.

## How I built it  
- Created a Manifest V3 Chrome extension (popup UI) with strict CSP and no inline scripts.
- Implemented Prompt API (LanguageModel) for attribute extraction, suggestion boosting, and “Explain rule” one-liners.
- Used **Summarizer API** for key-point summaries with **Prompt-API** fallback and timeouts.
- Added **Translator API** for multilingual outputs (EN/ES/JA), with Prompt fallback when needed.
- Wrote a fast suggestion web worker over generated mock data (tools/generate-mock-cpt.js, generate-mock-rules.js).
- Designed a slim, accessible UI: enter-to-submit, progress states, CSV export, persistent history, visible focus, and keyboard flow.
- Included Diagnostics to validate Data/Worker/LanguageModel/Translator/Summarizer before demoing.

## Challenges I ran into  
- **Model availability & cold-start:** managing downloads, timeouts, and fallbacks gracefully.
- **CSP & event handling:** eliminating inline handlers without losing responsiveness.
- **Suggestion recall:** ensuring breadth across imaging, E/M, labs, DME, vision, anesthesia, therapy, pathology with domain synonyms.
- **Localization:** keeping labels, messages, and outputs consistent across languages.

## Accomplishments that I'm proud of  
- A complete on-device, privacy-first workflow from description to payer-ready note, inside the browser.
- **“Explain rule”** turns opaque policy text into a clear rationale, inline.
- Coverage Snapshot and CSV export that feel ready for real teams.
- **Reliable demo:** offline after warm-up, diagnostics green, graceful degradations.

## What I learned  
- How to build and deploy a **Chrome extension**  
- Practical experience with **regex validation** for healthcare codes  
- The importance of balancing **usability, speed, and accuracy** in real-time tools  
- Strategies for designing **non-intrusive UI alerts**  

## What's next for CodeSure  
- Swap mock data for licensed CPT + payer policy sources via user keys.
- Add ICD-10/HCPCS and payer-specific templates; expand languages.
- Multimodal intake (OCR/PDF parsing) with on-device pre-processing.
- Hybrid AI option (Firebase AI Logic / Gemini API) for heavy tasks while preserving privacy.
- Export to standards (e.g., FHIR) and add an admin dashboard with analytics and compliance guardrails.

## MIT License

Copyright (c) 2025 Kayla

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the “Software”), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
=======
>>>>>>> dbe0e07 (chore: normalize line endings with .gitattributes)
