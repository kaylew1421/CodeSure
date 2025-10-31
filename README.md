# CodeSure – CPT Code Validator

**AI-Powered Medical Code Validation & Prior Authorization Assistant**

A Chrome extension leveraging Chrome's Built-in AI APIs (Gemini Nano) to validate medical codes, compare payer rules, and generate prior authorization notes—entirely on-device for complete privacy.

**Demo Video:** [CodeSure](https://youtu.be/your-demo-link)  
**GitHub Repository:** [GitHub](https://github.com/kaylew1421/CodeSure)

---

## Features

### Core Functionality

- **AI-Powered Code Suggestions** – Describe a medical service (e.g., "CT abdomen with contrast") and receive ranked CPT-like suggestions using Chrome's Prompt API.

- **Payer Rule Comparison** – Side-by-side comparison of coverage rules across 6 major payers (Medicare, BlueCross, UnitedHealth, Cigna, Aetna, Humana).

- **Multilingual Support** – Translate outputs to English, Spanish, or Japanese using the Translator API.

- **PA Note Builder** – Generate structured prior authorization documentation with AI assistance.

- **Coverage Snapshots** – Quick summaries combining payer rules and required documentation.

- **Diagnostics Dashboard** – Real-time status checks for all AI models and data loading.

- **Persistent History** – Popup remembers your recent suggestions/notes; includes Clear History.

- **Sync from Home + Autofill** – One-click brings patient/service details into the PA Note and auto-populates fields.

- **Paste from Capture** – Pulls your last captured text into the prompt for faster iteration.

- **Progress Bar for Check Auth Status** – Visual feedback so you know the process is running.

Demo uses synthetic 5-digit "CPT-like" codes and mock rules; no PHI; all AI runs locally.

---

## Technical Highlights

- **100% On-Device Processing** – All AI runs locally; no data leaves your browser.

- **Privacy-First Design** – Zero server calls, zero data collection.

- **Offline Capable** – Works without internet after initial model download.

- **Fast & Efficient** – Web Workers for code matching, intelligent caching.

- **Accessible UI** – Keyboard navigation, ARIA labels, screen reader support.

- **Popup-Only Architecture** – "Open in Tab" was removed to simplify UX; background service worker + content capture script support long tasks and paste-from-capture.

---

## Installation

### Prerequisites

- Chrome Canary or Chrome Dev (version 127+)
- ~22 MB free space for AI models (downloads automatically on first use)

### Step-by-Step Setup

#### 1. Enable Chrome's Built-in AI APIs

Open Chrome and enable these experimental flags:
```
chrome://flags/#optimization-guide-on-device-model
```
→ Set to "Enabled BypassPerfRequirement"
```
chrome://flags/#prompt-api-for-gemini-nano
```
→ Set to "Enabled"
```
chrome://flags/#translation-api
```
→ Set to "Enabled"

Restart Chrome after enabling flags.

#### 2. Download & Install Extension

Clone the repository:
```bash
git clone https://github.com/kaylew1421/CodeSure.git
cd codesure
```

Or download ZIP:

- Click the green Code button on GitHub → Download ZIP
- Extract the ZIP file to a folder

#### 3. Load into Chrome

- Open `chrome://extensions/`
- Enable Developer mode (toggle in top-right corner)
- Click Load unpacked
- Select the codesure folder
- Click the CodeSure icon in your Chrome toolbar

#### 4. First-Time Setup

On first use, Chrome will download AI models (~22 MB). This takes 1–2 minutes and happens automatically.

**Important:** This extension uses synthetic mock data for demonstration purposes. These are not real CPT codes or payer rules.

---

## Quick Start Guide

### Test the Extension in 5 Steps

1. **Open the Extension**  
   Click the CodeSure icon (popup opens on Home).

2. **Validate a Code**  
   Enter code: 64099 → Select payer: Medicare → Validate  
   See payer rule + coverage status.

3. **Try AI Suggestions**  
   In AI Assist, type: CT scan abdomen with contrast → Suggest Code  
   Review extracted attributes + suggestions → Use to add to validation field.

4. **Compare Payers**  
   Click Compare to open the payer table → Export CSV if needed.

5. **Build a PA Note**  
   Go to PA Note → Sync from Home → Autofill → Assemble → Copy.

---

## How It Works

### Architecture
```
User Input → Chrome Built-in AI APIs → Local Processing → Results
                    ↓
            (Gemini Nano Models)
                    ↓
        - Prompt API (structured extraction, rationale)
        - Summarizer API (policy key points)
        - Translator API (multilingual)
```

- Web Worker ranks codes from a local mock catalog.
- Background Service Worker coordinates long-running tasks, storage, and diagnostics.
- Content Capture Script enables paste-from-capture.

### Workflow

#### Code Suggestion Flow

1. User describes service (+ optional filename hints)
2. Prompt API extracts attributes (modality, body part, contrast, etc.)
3. Web Worker ranks codes
4. Results show Use and Compare actions

#### Validation Flow

1. User enters codes + payer
2. Matches against mock rules
3. Displays coverage status with color coding
4. Offers payer comparison table + CSV export

#### PA Note Generation Flow

1. Sync from Home pulls service/code/payer
2. Prompt API drafts sections (medical necessity, history, modifiers)
3. User polishes
4. Assembles into structured plain-text note

---

## Technologies Used

### Chrome Built-in AI APIs

- **Prompt API (LanguageModel)** – Attribute extraction, suggestions, rule explanations, note drafts

- **Summarizer API** – Policy key-point extraction with Prompt fallback

- **Translator API** – Multilingual output (EN/ES/JA) with Prompt fallback

Not using Write, Rewrite, or Proofreader APIs.

### Core Technologies

- **Chrome Extension Manifest V3** – Modern extension architecture

- **Web Workers** – Fast code matching without blocking UI

- **Chrome Storage API** – Persistent validation history

- **Content Security Policy** – Strict security, no inline scripts

### Development

- **Vanilla JavaScript** – No frameworks, maximum control

- **CSS Grid & Flexbox** – Responsive, accessible UI

- **Semantic HTML5** – WCAG 2.1-friendly markup

---

## Demo & Testing

### Recommended Test Scenarios

#### Scenario 1: Code Validation

- Code: 64099
- Payer: Medicare
- Expected: Shows rule requiring prior authorization

#### Scenario 2: AI Suggestions

- Input: "MRI brain without contrast"
- Expected: Extracted attributes + suggested codes (e.g., 70551*) and rationale

#### Scenario 3: Multi-Code Validation

- Codes: 64099, 32493, 99213
- Payer: BlueCross
- Expected: Three separate validation results + CSV export option

*Examples are illustrative; demo uses synthetic CPT-like codes.

### Known Limitations

- First AI operation may take 1–2 minutes (model download)
- Mock dataset covers ~50 sample codes
- Translation quality varies by language pair

---

## Project Story

### Inspiration

Medical claim denials cost the US healthcare system billions. Many denials stem from simple coding mistakes or misunderstood payer requirements. CodeSure aims to prevent errors at the point of entry—without sending sensitive data to the cloud.

### Challenges Overcome

- **Model Availability** – Robust fallbacks for unavailable APIs/timeouts

- **Multilingual Quality** – Consistent outputs across EN/ES/JA

- **CSP Compliance** – No inline scripts; MV3-compatible

- **User Experience** – Feature-rich yet simple for time-pressed clinicians

### What I Learned

- Implementing Chrome's experimental Built-in AI APIs
- Managing async model downloads and graceful degradation
- Designing privacy-first healthcare tools (no PHI exposure)
- Building accessible interfaces for high-stress workflows
- Optimizing on-device AI for speed and clarity

### Impact

Processing everything locally shows that privacy and intelligence can coexist:

- Complete data privacy (HIPAA-friendly architecture)
- Offline capability for low-connectivity settings
- Zero per-query costs
- Minimal latency
- Accessible for resource-limited practices

---

## Future Roadmap

### Near-Term (Q1 2025)

- ICD-10 and HCPCS support
- Expanded mock dataset (500+ codes)
- Dark mode theme
- Keyboard shortcuts

### Mid-Term (Q2–Q3 2025)

- Licensed CPT integration (user-provided API keys)
- OCR/PDF parsing for intake
- Payer-specific PA templates
- Browser sync for multi-device access

### Long-Term (2026+)

- Hybrid AI option (Firebase AI Logic for mobile)
- FHIR export capability
- Real-time claim scrubbing
- Analytics dashboard
- EHR integration pathways

---

## License

MIT License — see LICENSE for details.

Copyright (c) 2025 Kayla

---

## Author

**Kayla**  
Submission for Chrome Built-in AI Challenge 2025

---

## Acknowledgments

- Chrome team for the Built-in AI APIs
- Healthcare professionals who inspired this project
- Devpost for hosting the hackathon

---

## Support

Having issues? Check these first:

- Are you using Chrome Canary/Dev (not stable Chrome)?
- Are all flags enabled and Chrome restarted?
- Did models download? (Check Diagnostics)
- Is Developer mode enabled in chrome://extensions/?

For other issues, please open a GitHub issue.

---

**Disclaimer:** This extension uses synthetic mock data for demonstration purposes. It is not intended for actual medical coding or billing. Always consult official CPT codebooks and payer policies for real-world use.
