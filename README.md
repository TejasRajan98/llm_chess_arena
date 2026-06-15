# LLM Chess Arena

A premium, professional-grade chess platform where you can battle against or spectate Gemini models in real time. The project combines a modern desktop/mobile dashboard with dynamic game review engine analysis, interactive AI coaching, and customizable API settings.

---

## 🌟 Key Features

### 1. Diverse Game Modes
* **Anonymous Battle**: Play against a hidden model and guess which Gemini version it is at the end of the match.
* **Direct Battle**: Choose a specific Gemini model (Gemini 2.5 Flash, Gemini 1.5 Pro, Gemini 1.5 Flash), or play against local chess engines (**Stockfish** or a **Local Minimax** engine).
* **Spectate Battle**: Sit back and watch two different engines play against each other in real time with auto-play configurations.
* **Learn Mode**: Play against an AI opponent with real-time hints and explanations from your AI Coach.
* **Random Mid-Game**: Start from a chaotic, randomized mid-game board state and test your tactical recovery skills.

### 2. Deep Game Review & Live Move Analysis
* **Dynamic Accuracy Scores**: Live evaluation engine computing white and black accuracy percentages.
* **Move Quality Classification**: Categorizes and badges moves as **Brilliant**, **Best**, **Excellent**, **Book**, **Good**, **Inaccuracy**, **Mistake**, or **Blunder**.
* **Collapsible Stats Table**: A clean, collapsible move classification distribution table.
* **Scroll-Locked Move List**: An interactive, scrollable move list container that highlights and auto-centers the active move.

### 3. Gemini AI Chess Coach (Learn Mode)
* Provides explanations and chess hints directly in a sidebar chat panel.
* Powered by the Gemini 2.5 API, offering intelligent position-specific coaching.

### 4. Robust Client-Side API Key Storage
* Secure option to save your personal Gemini API Key inside browser `localStorage`.
* **Zero Backend Exposure**: Direct API requests to Google servers from your browser bypass the backend entirely to avoid server rate-limiting.

### 5. Advanced Responsive Layouts
* **Desktop Dashboard**: Lock viewport and center chessboard side-by-side with review/chat panels. Handles laptop/desktop screen heights dynamically using fluid parents (`#board-layout` sizing) to ensure the bottom player info bar ("You") is never cut off.
* **Mobile Layout**: Flow layout optimized for swiping and scrolling natively. The chessboard fits portrait screens completely, while panels are stacked cleanly below the board.
* **Asset Cache-Busting**: Standardized CSS and JS links include query strings (`?v=1.0.1`) to ensure browsers immediately download updates without requiring a manual hard refresh.

---

## 🛠️ Technology Stack

* **Backend**: Python 3.11+, FastAPI, Jinja2 Templates, httpx
* **Frontend**: Vanilla Javascript (Canvas API), Tailwind CSS, Chess.js, Stockfish.js
* **Build Utility**: Python script to compile templates, CSS, and JS into a standalone, single-file root `index.html`.

---

## 🚀 Getting Started

### 1. Requirements
* Python 3.11+
* [Google Gemini API Key](https://aistudio.google.com/) (Optional: Only if playing against Gemini models. Local engines run without keys).

### 2. Local Installation

1. **Clone the Repository** and navigate to the project directory:
   ```bash
   git clone <your-repo-url>
   cd llm_chess_arena
   ```

2. **Setup Environment Variables**:
   Copy `.env.example` to `.env` and configure your API key (if hosting a shared instance):
   ```bash
   # On Windows (PowerShell)
   Copy-Item chess_arena/.env.example chess_arena/.env
   # Edit chess_arena/.env and paste your GEMINI_API_KEY
   ```

3. **Initialize Virtual Environment**:
   ```bash
   # Create environment
   python -m venv venv

   # Activate on Windows (PowerShell)
   .\venv\Scripts\Activate.ps1
   
   # Activate on macOS/Linux
   source venv/bin/activate
   ```

4. **Install Dependencies**:
   ```bash
   pip install -r chess_arena/requirements.txt
   ```

5. **Run FastAPI Server**:
   ```bash
   uvicorn chess_arena.app.main:app --reload
   ```
   Open `http://127.0.0.1:8000` in your web browser.

---

## 📦 Bundling Single-File static index.html

We provide a compilation tool to package the templates, inline CSS, and client-side JavaScript (using direct API integration) into a single standalone HTML page (`index.html`) at the root:

```bash
python compile_html.py
```
This is useful for static page hosting (e.g., GitHub Pages, Vercel, Netlify) or offline use.

---

## ☁️ Cloud Deployment

The application features a Dockerfile optimized for Google Cloud Run:

```bash
gcloud run deploy chess-arena --source chess_arena --port 8080 --region us-central1 --allow-unauthenticated
```
