# 🧠 ConRad - AI-Powered RFP Automation System

> **ConRad** (Contract Radar) is an intelligent AI system that automates the entire RFP (Request for Proposal) lifecycle for cable supply companies. It transforms a **40+ hour manual process** into a **5-minute AI-powered workflow**.

---

## 📖 What is ConRad?

ConRad is a multi-agent AI system that helps cable manufacturing companies:

- **🔍 Discover RFPs** - Automatically searches across multiple procurement portals
- **📄 Analyze Documents** - AI reads and understands RFP PDFs instantly
- **✅ Match Products** - Automatically matches RFP requirements to your product catalog
- **💰 Generate Quotations** - Calculates accurate pricing with GST, margins, and testing costs
- **📋 Create Submissions** - Generates professional bid documents ready for submission
- **📅 Track Deadlines** - Sends reminders and manages submission schedules

### The Problem It Solves

**Before ConRad:**
- Manual monitoring of 3 portals daily (Government, Industrial, Utilities)
- Downloading and reading 50+ PDFs weekly (30+ pages each)
- Manual product matching and quotation calculation
- 40+ hours per week spent on RFP processing
- Missing 60%+ of relevant opportunities

**With ConRad:**
- Automated portal scanning
- Instant PDF analysis with AI
- Automatic product matching
- AI-generated quotations
- 5 minutes per RFP
- 100% opportunity capture

---

## 🚀 Quick Start (Basic Installation)

### Prerequisites

- **Node.js 18+** (Download from [nodejs.org](https://nodejs.org/))
- **npm** (comes with Node.js)
- **Git** (for cloning the repository)

### Basic Setup (5 minutes)

```bash
# 1. Clone the repository
git clone <your-repo-url>
cd ConRad_Final_Submission

# 2. Install dependencies
npm install

# 3. Create environment file
# Windows:
copy .env.example .env

# Linux/Mac:
cp .env.example .env

# 4. Get a free Gemini API key
# Visit: https://aistudio.google.com/app/apikey
# Copy your API key and add it to .env file:
# GEMINI_API_KEY=your_api_key_here

# 5. Start the server
npm start
```

**That's it!** Open your browser to:
- **Main Interface:** http://localhost:5000/chat.html
- **Portal Dashboard:** http://localhost:5000/

---

## 🔧 Full Installation (Advanced Features)

### Step 1: Basic Setup (Required)
Follow the Quick Start steps above.

### Step 2: Optional AI Providers

For better performance and fallback options, add these to your `.env` file:

```env
# Required - Get from https://aistudio.google.com/app/apikey
GEMINI_API_KEY=your_gemini_key

# Optional - For fallback when Gemini is unavailable
OPENAI_API_KEY=your_openai_key

# Optional - For scanned PDF extraction (better OCR)
AWS_ACCESS_KEY_ID=your_aws_key
AWS_SECRET_ACCESS_KEY=your_aws_secret
AWS_REGION=ap-south-1
```

### Step 3: Vector Store Initialization (Optional)

For advanced AI search capabilities:

```bash
# Initialize vector database for semantic search
npm run init-vector-store

# Precompute embeddings for faster searches
npm run precompute-embeddings
```

### Step 4: Adaptive Learning System (Optional)

Enable the AI learning system that improves over time:

```bash
# Initialize learning database
npm run init-learning

# Or run in watch mode for continuous learning
npm run init-learning:watch
```

### Step 5: Voice Service (Optional)

For voice input capabilities:

```bash
# Install Python dependencies
cd voice-service
pip install -r requirements.txt
cd ..

# The voice service starts automatically when you run npm start
# Or start manually: cd voice-service && python voice_server.py
```

### Step 6: Verify Installation

```bash
# Check if everything is working
npm start

# You should see:
# ✅ ConRad Server Started
# ✅ Voice Service ready (if enabled)
# ✅ Database initialized
```

---

## ⚙️ Azure services (recommended for PDF OCR & Speech)

ConRad can use Microsoft Azure for high-quality PDF extraction (Document Intelligence) and Speech-to-Text (Cognitive Services - Speech). These services are optional but recommended for reliable OCR and live voice input.

Required environment variables

Add the following to your `.env` file (or ensure they exist in your deployment environment):

```env
# Azure Document Intelligence (formerly Form Recognizer)
AZURE_DOC_ENDPOINT=https://<your-resource-name>.cognitiveservices.azure.com
AZURE_DOC_KEY=<your_document_intelligence_key>

# Azure Cognitive Services - Speech
AZURE_SPEECH_KEY=<your_speech_key>
AZURE_SPEECH_REGION=<your_speech_region> # e.g. eastus, westus2
```

Notes:
- Keep these keys secret. Do NOT commit your `.env` to source control. Use `.env.example` as a template.
- The project already attempts Azure first for PDF analysis and falls back to local parsing if Azure is not configured or fails.

Quick test: Azure Document Intelligence

There is a small test harness at `scripts/test-azure-doc.js` that calls the Document Intelligence wrapper directly. To run it locally:

```powershell
# Windows PowerShell (from project root)
node scripts/test-azure-doc.js path\to\sample.pdf
```

If the call succeeds you will see a structured JSON result printed to the console. If it fails, copy the console output (including full error object) and paste it here for debugging.

Quick test: API endpoint

You can also POST a PDF to the running server's analyze endpoint:

```powershell
# Upload a PDF to the server (PowerShell)
$resp = Invoke-RestMethod -Uri http://localhost:5000/api/pdf/analyze -Method Post -Form @{ pdf = Get-Item 'path\to\sample.pdf' }
Write-Output $resp
```

Or using curl (if you prefer):

```bash
curl -X POST "http://localhost:5000/api/pdf/analyze" -F "pdf=@path/to/sample.pdf"
```

Quick test: Speech-to-Text

The backend exposes a speech route used by the frontend. To test the speech route (it uses Azure's speech SDK which expects audio input via microphone by default), use the UI at `/chat.html` and the built-in voice button. The frontend now uses the backend route `/api/speech/transcribe` which in turn calls Azure.

If you want to run an automated speech test, ensure your environment has microphone access and the server has `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` set. The route will return `{ success: true, text: "..." }` on success.

Troubleshooting

- If Azure calls fail with authentication errors, verify the endpoint URL and key in `.env`.
- For Document Intelligence, ensure the resource region matches the endpoint (endpoint host contains region information).
- If you see SDK response shape differences, check server logs — the Document Intelligence wrapper now logs the raw SDK result and error objects for debugging.


## 📋 How ConRad Works

### 1. RFP Discovery Process

```
User Query: "Find HT cables 11kV in Mumbai"
    ↓
AI Agent searches across portals:
    ├── Government Portal (gov.json)
    ├── Industrial Portal (industrial.json)
    └── Utilities Portal (utilities.json)
    ↓
Returns matching RFPs with:
    - Tender ID, Title, Organization
    - Estimated Cost, Due Date
    - Material Specifications
    - Location & Contact Info
```

### 2. RFP Analysis Process

```
Upload RFP PDF
    ↓
AI Extracts:
    ├── Bill of Quantities (BOQ)
    ├── Technical Specifications
    ├── Submission Requirements
    └── Deadlines & Contact Info
    ↓
Product Matching:
    ├── Compares RFP specs with product catalog
    ├── Finds matching SKUs
    └── Calculates match percentage
    ↓
Feasibility Check:
    ├── Can we bid? (Yes/No)
    ├── Win Probability Score
    └── Risk Assessment
```

### 3. Quotation Generation Process

```
RFP Analysis Results
    ↓
Pricing Engine:
    ├── Base Product Price (from catalog)
    ├── Testing Costs (from testing.csv)
    ├── GST Calculation (18%)
    ├── Margin Application (from pricing_rules.csv)
    └── Delivery Charges (location-based)
    ↓
Generates:
    ├── Itemized Quotation
    ├── Total Cost Breakdown
    └── Professional PDF Document
```

### 4. Submission Package Creation

```
Quotation + RFP Details
    ↓
Submission Mode Detection:
    ├── EMAIL_FORM (fill PDF form and email)
    ├── LETTER_COURIER (print and courier)
    ├── EXTERNAL_PORTAL (register on portal)
    └── MEETING_EMAIL (schedule pre-bid meeting)
    ↓
Preview Generation:
    ├── Email preview (to, subject, body)
    ├── Letter preview (company details, content)
    ├── Portal instructions preview
    └── Calendar event preview
    ↓
User Review & Edit:
    ├── Modify any field via chat
    ├── AI-powered modifications
    └── Visual preview of changes
    ↓
Final Generation:
    ├── Generate PDF/Word documents
    ├── Create calendar reminders (.ics)
    ├── Open Gmail compose (for emails)
    └── Download printable documents
```

### 5. Adaptive CSV Upload Process

```
User uploads CSV via chat interface
    ↓
File Preview:
    ├── Shows file name and size
    ├── Allows adding instructions
    └── User can remove before sending
    ↓
CSV Analysis:
    ├── HuggingFace embeddings detect CSV type
    ├── Semantic column mapping
    ├── Structure validation
    └── Confidence scoring
    ↓
Session Storage:
    ├── Overrides default data for session
    ├── Applies to quotations immediately
    └── Auto-clears on server restart
    ↓
Preview & Confirmation:
    ├── Shows detected type and mappings
    ├── Displays row count and changes
    └── User confirms or modifies
```

---

## 🗂️ Project Structure

```
ConRad_Final_Submission/
│
├── 📄 index.js              # Main server entry point
├── 📄 package.json          # Dependencies & scripts
├── 📄 .env.example          # Environment variables template
│
├── 📂 routes/               # API endpoints
│   ├── chat.js             # Main AI chat interface
│   ├── ai-search.js        # RFP search orchestration
│   ├── rfp-analysis.js     # RFP analysis endpoints
│   └── ...
│
├── 📂 services/             # Core business logic
│   ├── multi-ai-provider.js    # AI provider management
│   ├── rfp-analysis-service.js # RFP processing
│   ├── product-matcher.js      # Product matching logic
│   ├── pricing-analysis.js     # Quotation engine
│   └── ...
│
├── 📂 agentic/              # Multi-agent system (LangGraph)
│   ├── master-agent.js     # Orchestrator agent
│   ├── sales-agent.js      # RFP discovery agent
│   ├── technical-agent.js  # Technical analysis agent
│   └── pricing-agent.js    # Pricing agent
│
├── 📂 data/                 # Product catalogs & rules
│   ├── products/           # Product CSV files
│   │   ├── ht_cables.csv
│   │   ├── lt_cables.csv
│   │   └── ...
│   ├── pricing_rules.csv   # Pricing configuration
│   └── testing.csv         # Testing costs
│
├── 📂 public/               # Frontend files
│   ├── index.html          # Main dashboard
│   ├── chat.html           # AI chat interface
│   ├── portals/            # Portal-specific pages
│   └── assets/             # CSS, JS, images
│
└── 📂 templates/            # Document templates
    └── *.docx              # Word templates for submissions
```

---

## 🔑 Key Features

### 🤖 Multi-Agent AI System
- **Master Agent**: Orchestrates the entire workflow
- **Sales Agent**: Discovers and filters RFPs
- **Technical Agent**: Analyzes specifications
- **Pricing Agent**: Calculates quotations
- **Submission Agent**: Creates bid packages

### 🧠 Adaptive Learning & CSV Upload System
- **CSV Upload via Chat Interface**: Upload custom CSV files directly through the chat
- **Intelligent CSV Detection**: Uses HuggingFace embeddings to automatically detect CSV type (testing, pricing, products)
- **Semantic Column Mapping**: Automatically maps CSV columns to expected schemas using semantic similarity
- **Session-Based Adaptation**: Uploaded CSVs override default data for the current session
- **Preview Before Use**: Preview detected structure and mappings before applying
- **Natural Language Instructions**: Add context like "use these prices for quotations" when uploading
- Learns from user feedback
- Improves product matching over time
- Adapts to company-specific requirements
- Stores learning data in vector database

### 🔍 Intelligent Search
- Natural language queries ("HT cables 11kV Mumbai")
- Multi-portal aggregation
- Semantic search with embeddings
- Product permutation matching

### 📊 Smart Analysis
- Automatic BOQ extraction
- Product specification matching
- Feasibility assessment
- Win probability calculation
- Risk clause detection

### 💰 Automated Pricing
- Product catalog integration
- Testing cost calculation
- GST and margin application
- Location-based delivery charges
- Professional quotation generation

### 📋 Preview-Based Submission Modes
ConRad supports 4 different submission modes, each with interactive preview:

1. **EMAIL_FORM** - Fill form inside PDF and email
   - Preview email with recipient, subject, and body
   - Edit before sending
   - Direct Gmail integration

2. **LETTER_COURIER** - Physical letter/courier submission
   - Preview cover letter with company details
   - Generate printable PDF on letterhead
   - Includes courier address and instructions

3. **EXTERNAL_PORTAL** - Register on separate vendor portal
   - Preview portal registration details
   - Generate submission package
   - Calendar reminders for registration deadlines

4. **MEETING_EMAIL** - Pre-bid meeting request
   - Preview meeting request email
   - Schedule calendar event
   - Generate meeting agenda

**Preview Features:**
- Edit all fields before finalizing
- AI-powered modifications ("make it shorter", "add quality certifications")
- Visual preview of generated content
- One-click proceed to final action (Gmail, Calendar, PDF download)

---

## 🛠️ Complete Technology Stack

### Backend Framework
- **Node.js 18+** - Runtime environment
- **Express.js 4.19** - Web server framework
- **ES Modules** - Modern JavaScript module system

### AI & Machine Learning
- **Google Gemini 2.0 Flash** - Primary AI provider for analysis and generation
- **OpenAI GPT-4o-mini** - Fallback AI provider
- **LangChain** - AI orchestration framework
- **LangGraph** - Multi-agent workflow management
- **HuggingFace Transformers** - Local embeddings and model inference
- **ChromaDB** - Vector database for semantic search
- **Local Embeddings** - All-MiniLM-L6-v2 for CSV type detection

### Document Processing
- **pdf-parse** - PDF text extraction
- **AWS Textract** - Advanced OCR for scanned PDFs and table extraction
- **mammoth** - Word document (.docx) parsing
- **pdfkit** - PDF generation
- **docx/docxtemplater** - Word document generation from templates
- **Puppeteer** - Web scraping and PDF rendering

### Data Management
- **better-sqlite3** - SQLite database for session storage
- **csv-parse** - CSV file parsing and processing
- **Cheerio** - HTML parsing and web scraping
- **Axios** - HTTP client for API calls

### Frontend Technologies
- **Vanilla JavaScript** - No framework dependencies
- **Chart.js** - Data visualization
- **HTML5/CSS3** - Modern web standards

### Utilities & Services
- **dotenv** - Environment variable management
- **helmet** - Security headers
- **cookie-parser** - Session management
- **express-session** - Session storage
- **multer** - File upload handling
- **node-cron** - Scheduled tasks
- **dayjs** - Date manipulation
- **uuid** - Unique ID generation
- **qrcode** - QR code generation
- **ics** - Calendar event generation (.ics files)
- **fontkit** - Font handling for PDF generation

### Voice Service (Optional)
- **Python 3.10+** - Voice service runtime
- **FastAPI** - Voice API server
- **FasterWhisper** - Speech-to-text (local, no API costs)
- **Uvicorn** - ASGI server

### Development Tools
- **Jest** - Testing framework
- **Git** - Version control

### Cloud Services (Optional)
- **AWS Textract** - Document analysis and OCR
- **Google AI Studio** - Gemini API access
- **OpenAI Platform** - GPT API access

### Data Formats
- **JSON** - Configuration and API responses
- **CSV** - Product catalogs and pricing data
- **PDF** - RFP documents and generated bids
- **DOCX** - Document templates
- **ICS** - Calendar events

---

## 🛠️ Available Scripts

```bash
# Start the server
npm start

# Development mode (auto-restart on changes)
npm run dev

# Initialize vector store for semantic search
npm run init-vector-store

# Precompute embeddings for faster searches
npm run precompute-embeddings

# Initialize adaptive learning system
npm run init-learning

# Run learning in watch mode
npm run init-learning:watch

# Fine-tune AI models (advanced)
npm run finetune
```

---

## 🌐 API Endpoints

### Core Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat` | POST | Main AI chat interface |
| `/api/ai-search/query` | POST | Search RFPs across portals |
| `/api/rfp-proceed/analyze` | POST | Analyze uploaded RFP PDF |
| `/api/rfp-response/generate` | POST | Generate quotation |
| `/api/upload` | POST | Upload RFP documents |
| `/api/feasibility` | POST | Check bid feasibility |
| `/api/compare` | POST | Compare multiple RFPs |

### Example Usage

```javascript
// Search RFPs
POST /api/ai-search/query
{
  "query": "HT cables 11kV in Mumbai",
  "portals": ["gov", "industrial", "utilities"]
}

// Analyze RFP
POST /api/rfp-proceed/analyze
{
  "rfpId": "GOV-100",
  "pdfUrl": "/rfps/GOV-100.pdf"
}
```

---

## 🔐 Environment Variables

Create a `.env` file from `.env.example`:

```env
# Required
GEMINI_API_KEY=your_gemini_api_key

# Optional - AI Providers
OPENAI_API_KEY=your_openai_key

# Optional - AWS Textract (for scanned PDFs)
AWS_ACCESS_KEY_ID=your_aws_key
AWS_SECRET_ACCESS_KEY=your_aws_secret
AWS_REGION=ap-south-1

# Optional - HuggingFace (for embeddings)
HUGGINGFACE_API_KEY=your_hf_key

# Server Configuration
PORT=5000
NODE_ENV=development
```

**⚠️ Important:** Never commit your `.env` file to Git! It's already excluded via `.gitignore`.

---

## 📚 Data Files

### Product Catalogs
Located in `data/products/`:
- `ht_cables.csv` - High Tension cables (150+ products)
- `lt_cables.csv` - Low Tension cables (200+ products)
- `control_cables.csv` - Control cables (100+ products)
- `ehv_cables.csv` - Extra High Voltage (50+ products)
- `instrumentation_cables.csv` - Instrumentation (80+ products)

### Configuration Files
- `data/pricing_rules.csv` - GST rates, margins, delivery rules
- `data/testing.csv` - Testing costs for various cable tests
- `data/oem_specs.csv` - OEM specifications
- `data/rfp_requirements.csv` - RFP requirement patterns

---

## 🐛 Troubleshooting

### Server won't start
```bash
# Check Node.js version
node --version  # Should be 18+

# Clear npm cache
npm cache clean --force

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### AI not responding
```bash
# Check API keys in .env file
# Verify GEMINI_API_KEY is set correctly
# Test API key: Visit https://aistudio.google.com/app/apikey
```

### PDF extraction failing
```bash
# For scanned PDFs, enable AWS Textract in .env
# Or use Gemini AI fallback (slower but free)
```

### Vector store errors
```bash
# Reinitialize vector store
npm run init-vector-store

# Clear and rebuild
rm -rf .cache/chroma
npm run init-vector-store
```

---

## 📝 Development

### Adding New Product Categories

1. Create CSV file in `data/products/`
2. Follow existing CSV structure (SKU, Description, Specs, Price)
3. Update `config/vendor-mapping.js` if needed
4. Restart server

### Customizing Pricing Rules

Edit `data/pricing_rules.csv`:
- GST rates
- Margin percentages
- Delivery charge rules
- Location-based pricing

### Adding New Portals

1. Create portal JSON file in `public/data/portals/`
2. Update `config/portals.js`
3. Add portal-specific scraper in `adapters/`

---

## 🎯 Use Cases

### 1. Daily RFP Discovery
```
"Show me all HT cable RFPs in Mumbai this week"
→ Returns filtered list with deadlines
```

### 2. Quick RFP Analysis
```
Upload RFP PDF → "Analyze this and tell me if we can bid"
→ Returns feasibility, match percentage, win probability
```

### 3. Generate Quotation
```
"Create quotation for GOV-100 with 15% margin"
→ Generates professional PDF quotation
```

### 4. Compare Multiple RFPs
```
"Compare GOV-100, IND-200, and UTL-300"
→ Side-by-side comparison with recommendations
```

### 5. Upload Custom Pricing Data
```
Upload CSV file → "Use these testing prices for quotations"
→ System detects CSV type, maps columns, applies to session
→ All future quotations use new pricing
```

### 6. Preview Before Submission
```
"Generate submission for GOV-100"
→ Shows preview of email/letter with all details
→ "Change contact person to John Doe"
→ AI modifies and shows updated preview
→ "Proceed" → Opens Gmail or downloads PDF
```

---

## 📞 Support

For issues or questions:
1. Check the troubleshooting section above
2. Review the existing README_ADAPTIVE_AI.md for detailed documentation
3. Check API endpoint documentation in `/api` routes

---

## 📄 License

MIT License - See LICENSE file for details

---

## 🙏 Acknowledgments

Built for **EY Techathon 6.0** - Revolutionizing Cable Supply RFP Discovery & Response

---

**Ready to automate your RFP process?** Start with the Quick Start guide above and transform your 40+ hour workflow into 5 minutes! 🚀
