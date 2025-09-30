# CodeSure – CPT Code Validator

**AI-Powered Medical Code Validation & Prior Authorization Assistant**

A Chrome extension leveraging Chrome's Built-in AI APIs (Gemini Nano) to validate medical codes, compare payer rules, and generate prior authorization notes—entirely on-device for complete privacy.

**Demo Video:** **TBD** 

**GitHub Repository:** **https://github.com/kaylew1421/CodeSure**

---

## Features

### Core Functionality
- **AI-Powered Code Suggestions** – Describe a medical service (e.g., "CT abdomen with contrast") and receive ranked CPT code suggestions using Chrome's Prompt API
- **Payer Rule Comparison** – Side-by-side comparison of coverage rules across 6 major payers (Medicare, BlueCross, UnitedHealth, Cigna, Aetna, Humana)
- **Policy Summarizer** – Extract key points from any policy page with one click using the Summarizer API
- **Multilingual Support** – Translate outputs to English, Spanish, or Japanese using the Translator API
- **PA Note Builder** – Generate structured prior authorization documentation with AI assistance
- **Coverage Snapshots** – Quick summaries combining payer rules and required documentation
- **Diagnostics Dashboard** – Real-time status checks for all AI models and data loading

### Technical Highlights
- **100% On-Device Processing** – All AI runs locally; no data leaves your browser
- **Privacy-First Design** – Zero server calls, zero data collection
- **Offline Capable** – Works without internet after initial model download
- **Fast & Efficient** – Web Workers for code matching, intelligent caching
- **Accessible UI** – Keyboard navigation, ARIA labels, screen reader support

---

## Installation

### Prerequisites
- **Chrome Canary** or **Chrome Dev** (version 127+)
- ~22MB free space for AI models (downloads automatically on first use)

### Step-by-Step Setup

**1. Enable Chrome's Built-in AI APIs**

Open Chrome and enable these experimental flags:

```
chrome://flags/#optimization-guide-on-device-model
→ Set to "Enabled BypassPerfRequirement"

chrome://flags/#prompt-api-for-gemini-nano
→ Set to "Enabled"

chrome://flags/#summarization-api-for-gemini-nano
→ Set to "Enabled"

chrome://flags/#translation-api
→ Set to "Enabled"
```

**Restart Chrome** after enabling flags.

**2. Download & Install Extension**

```bash
# Clone the repository
git clone https://github.com/yourusername/codesure.git
cd codesure
```

Or download ZIP:
- Click the green "Code" button on GitHub → "Download ZIP"
- Extract the ZIP file to a folder

**3. Load into Chrome**

1. Open `chrome://extensions/`
2. Enable **"Developer mode"** (toggle in top-right corner)
3. Click **"Load unpacked"**
4. Select the `codesure` folder
5. Click the CodeSure icon in your Chrome toolbar

**4. First-Time Setup**

On first use, Chrome will download AI models (~22MB). This takes 1-2 minutes and happens automatically.

**Important:** This extension uses **synthetic mock data** for demonstration purposes. These are NOT real CPT codes or payer rules.

---

## Quick Start Guide

### Test the Extension in 5 Steps

1. **Open the Extension**
   - Click the CodeSure icon in your toolbar
   - The popup will appear with the Home tab active

2. **Validate a Code**
   - Enter code: `64099`
   - Select payer: `Medicare`
   - Click "Validate"
   - See the payer rule and coverage status

3. **Try AI Suggestions**
   - In "AI Assist" section, type: `CT scan abdomen with contrast`
   - Click "Suggest Code"
   - Review AI-extracted attributes and code suggestions
   - Click "Use" to add a suggestion to the validation field

4. **Test Policy Summarizer**
   - Navigate to a policy page (try: https://www.cms.gov/medicare-coverage-database)
   - Open CodeSure → "Policy Summarizer" tab
   - Click "Summarize This Page"
   - Wait 15-30 seconds for on-device processing
   - Try translating to Spanish or Japanese

5. **Build a PA Note**
   - Go to "PA Note" tab
   - Click "Sync from Home" to pull in your codes
   - Click "Autofill" to generate AI draft content
   - Click "Assemble" to create final note
   - Click "Copy" to copy to clipboard

---

## How It Works

### Architecture

```
User Input → Chrome Built-in AI APIs → Local Processing → Results
                    ↓
            (Gemini Nano Models)
                    ↓
        - Prompt API (structured extraction)
        - Summarizer API (key points)
        - Translator API (multilingual)
```

### Workflow

1. **Code Suggestion Flow**
   - User describes service (+ optional file attachments)
   - Prompt API extracts structured attributes (modality, body part, contrast, etc.)
   - Web Worker ranks codes by token matching
   - Results displayed with "Use" and "Compare" buttons

2. **Validation Flow**
   - User enters codes and selects payer
   - Extension matches against mock rules database
   - Displays coverage status with color coding
   - Offers payer comparison table with CSV export

3. **Summarization Flow**
   - Extension reads visible text from active tab
   - Summarizer API generates key points (or falls back to Prompt API)
   - Results can be translated to ES/JA
   - Key terms highlighted on original page

4. **PA Note Generation Flow**
   - User syncs service/code/payer from Home tab
   - Prompt API drafts field content (medical necessity, history, modifiers)
   - User can polish with proofreading
   - Assembles into structured plain-text note

---

## Technologies Used

### Chrome Built-in AI APIs
- **Prompt API** (LanguageModel) – Structured attribute extraction, code suggestions, rule explanations, note generation
- **Summarizer API** – Key-point extraction from policy documents
- **Translator API** – Multilingual output (EN/ES/JA) with Prompt API fallback

### Core Technologies
- **Chrome Extension Manifest V3** – Modern extension architecture
- **Web Workers** – Fast code matching without blocking UI
- **Chrome Storage API** – Persistent validation history
- **Content Security Policy** – Strict security with no inline scripts

### Development
- **Vanilla JavaScript** – No frameworks, maximum performance
- **CSS Grid & Flexbox** – Responsive, accessible UI
- **Semantic HTML5** – WCAG 2.1 compliant markup

---

## Demo & Testing

### Recommended Test Scenarios

**Scenario 1: Code Validation**
```
Code: 64099
Payer: Medicare
Expected: Shows rule requiring prior authorization
```

**Scenario 2: AI Suggestions**
```
Input: "MRI brain without contrast"
Expected: Suggests codes 70551, 70552, etc. with modality extraction
```

**Scenario 3: Multi-Code Validation**
```
Codes: 64099, 32493, 99213
Payer: BlueCross
Expected: Shows 3 separate validation results
```

**Scenario 4: Policy Summarization**
```
Page: Any medical policy page (e.g., CMS LCD)
Expected: 5-7 bullet points of key requirements
Time: 15-30 seconds
```

### Known Limitations
- First AI operation may take 1-2 minutes (model download)
- Summarizer works best on text-heavy pages (400-2000 chars)
- Mock data only covers ~50 sample codes
- Translation quality varies by language pair

---

## Project Story

### Inspiration
Medical claim denials cost the US healthcare system $262 billion annually. Many denials result from simple coding errors or misunderstood payer requirements. I wanted to build a tool that prevents these errors at the point of entry—without sending sensitive medical data to the cloud.

### Challenges Overcome
1. **Model Availability** – Built robust fallbacks for when APIs aren't available or fail
2. **Performance** – Optimized for 30-second summarization on resource-constrained devices
3. **Multilingual Quality** – Ensured consistent output across EN/ES/JA with translation validation
4. **CSP Compliance** – Eliminated all inline scripts for Manifest V3 compliance
5. **User Experience** – Balanced feature richness with simplicity for time-pressed clinicians

### What I Learned
- Implementing Chrome's experimental Built-in AI APIs in production
- Managing async model loading, downloads, and graceful degradation
- Building privacy-first healthcare tools that never expose PHI
- Designing accessible interfaces for high-stress medical workflows
- Optimizing on-device AI for speed without sacrificing accuracy

### Impact
This extension demonstrates that **privacy and intelligence aren't mutually exclusive**. By processing everything locally, CodeSure enables:
- Complete data privacy (HIPAA-friendly architecture)
- Offline capability for rural/low-connectivity settings
- Zero per-query costs (no API fees)
- Instant results (no network latency)
- Accessibility for resource-limited practices

---

## Future Roadmap

### Near-Term (Q1 2025)
- ICD-10 and HCPCS code support
- Expanded mock dataset (500+ codes)
- Dark mode theme
- Keyboard shortcuts

### Mid-Term (Q2-Q3 2025)
- Licensed CPT database integration (user-provided API keys)
- OCR/PDF parsing for document intake
- Payer-specific PA templates
- Browser sync for multi-device access

### Long-Term (2026+)
- Hybrid AI option (Firebase AI Logic for mobile)
- FHIR export capability
- Real-time claim scrubbing
- Analytics dashboard for practices
- Integration with EHR systems

---

## License

MIT License - see [LICENSE](LICENSE) file for details.

**Copyright (c) 2025 Kayla**

---

## Author

**Kayla**  
Submission for [Chrome Built-in AI Challenge 2025](https://googlechromeai.devpost.com/)

---

## Acknowledgments

- Chrome team for the Built-in AI APIs
- Healthcare professionals who inspired this project
- Devpost for hosting the hackathon

---

## Support

Having issues? Check these first:
1. Are you using Chrome Canary/Dev (not stable Chrome)?
2. Are all flags enabled and Chrome restarted?
3. Did models download? (Check Diagnostics tab)
4. Is Developer Mode enabled in chrome://extensions/?

For other issues, please [open a GitHub issue](https://github.com/yourusername/codesure/issues).

---

**Disclaimer:** This extension uses synthetic mock data for demonstration purposes. It is NOT intended for actual medical coding or billing. Always consult official CPT codebooks and payer policies for real-world use.
