# CodeSure – CPT Code Validator

A Chrome extension that uses Chrome's Built-in AI APIs to help validate medical codes, compare payer rules, and generate prior authorization notes—entirely on-device.

**🎥 [Demo Video](YOUR_VIDEO_LINK_HERE)**

## Features

- **AI-Powered Code Suggestions** (Prompt API): Describe a service and get ranked CPT code suggestions
- **Payer Rule Comparison**: Side-by-side comparison of coverage rules across 6 major payers
- **Policy Summarizer** (Summarizer API): Extract key points from policy pages with one click
- **Multilingual Support** (Translator API): EN/ES/JA translation for all outputs
- **PA Note Builder**: AI-assisted generation of prior authorization documentation
- **Coverage Snapshots**: Quick summaries combining payer rules and required documentation
- **Diagnostics Dashboard**: Real-time status checks for all AI models

## Technologies Used

- **Prompt API** (LanguageModel): Structured attribute extraction, code suggestions, rule explanations
- **Summarizer API**: Key-point extraction from policy documents
- **Translator API**: Multilingual output with Prompt API fallback
- Chrome Extension Manifest V3
- Web Workers for fast code matching
- Local storage for validation history

## Installation

1. Clone this repository
2. Enable Chrome's Built-in AI:
   - Navigate to `chrome://flags/#optimization-guide-on-device-model`
   - Set to "Enabled BypassPerfRequirement"
   - Navigate to `chrome://flags/#prompt-api-for-gemini-nano`
   - Set to "Enabled"
   - Relaunch Chrome
3. Open `chrome://extensions/`
4. Enable "Developer mode"
5. Click "Load unpacked" and select the extension folder
6. Click the CodeSure icon in your toolbar

**Note:** Uses synthetic mock data for demonstration—not real CPT codes or payer rules.

## Inspiration

Medical claim denials waste time and money due to coding errors and misunderstood payer rules. CodeSure delivers on-device intelligence to help clinicians and billers validate codes and understand requirements before submission—with complete privacy.

## How It Works

1. **Describe the service** or upload supporting documents
2. **Get AI-suggested codes** ranked by relevance
3. **Validate against payer rules** with instant comparison
4. **Generate PA notes** with structured AI assistance
5. **Export results** as CSV or copy to clipboard

All processing happens locally in your browser—no data ever leaves your device.

## Challenges

- Managing model availability, downloads, and timeout handling
- Balancing speed vs. detail in summarization (30s for on-device processing)
- Supporting multiple languages with consistent quality
- Building reliable fallbacks when APIs are unavailable

## What I Learned

- Implementing Chrome's experimental Built-in AI APIs
- Building production-ready Chrome extensions with Manifest V3
- Designing privacy-first healthcare tools
- Handling async AI model loading and graceful degradation

## Future Plans

- Integration with licensed CPT/ICD-10 databases via API keys
- ICD-10 and HCPCS code support
- OCR/PDF parsing for document intake
- Hybrid AI option (Firebase AI Logic / Gemini API) for mobile reach
- FHIR export capability

## License

MIT License - see [LICENSE](LICENSE) file for details

## Author

Kayla - [Chrome Built-in AI Challenge 2025](https://googlechromeai.devpost.com/)
