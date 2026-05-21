# LLM Chess Arena

A professional web application featuring an AI-powered Chess Arena where you can play against or spectate Gemini models. 

## Features
- **Multiple Game Modes**: Anonymous Battle, Direct Battle, Spectate, Learn Mode, and Random Mid-Game.
- **FastAPI Backend**: Secures the Gemini API Key and serves the frontend.
- **Responsive UI**: Modern UI utilizing Tailwind CSS.
- **Docker-Ready**: Prepared for immediate deployment to Google Cloud Run or any container hosting platform.

## Getting Started

### 1. Requirements
- Python 3.11+
- [Google Gemini API Key](https://aistudio.google.com/)

### 2. Local Setup
Clone this repository (or download the source), then follow these steps:

1. **Environment Variables**:
   Copy the example environment file and insert your API key:
   ```bash
   cp .env.example .env
   # Edit .env and replace with your actual GEMINI_API_KEY
   ```

2. **Virtual Environment**:
   Create and activate a Python virtual environment:
   ```bash
   # Windows
   python -m venv venv
   .\venv\Scripts\activate
   
   # macOS/Linux
   python3 -m venv venv
   source venv/bin/activate
   ```

3. **Install Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Run the Server**:
   Start the FastAPI development server:
   ```bash
   uvicorn app.main:app --reload
   ```

5. **Open the App**:
   Navigate to `http://127.0.0.1:8000` in your web browser.

## Deployment to Cloud Run
This project includes a `Dockerfile` optimized for Google Cloud Run. You can deploy it using the Google Cloud CLI or by linking your GitHub repository to Cloud Build.

```bash
gcloud run deploy chess-arena --source . --port 8080 --set-env-vars="GEMINI_API_KEY=your_api_key_here"
```
