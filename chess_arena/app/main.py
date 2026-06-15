import os
import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="LLM Chess Arena API")

app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")

class GenerateRequest(BaseModel):
    prompt: str
    persona: str = "an expert chess engine"
    model: str = "Gemini 2.5 Flash"
    apiKey: str = None

@app.get("/")
async def read_root(request: Request):
    return templates.TemplateResponse(request, "index.html")

@app.post("/api/generate")
async def generate_content(req: GenerateRequest):
    # Use client-provided API key if set, otherwise fallback to server environment key
    api_key = req.apiKey or os.getenv("GEMINI_API_KEY")
    
    # Run local minimax if selected OR if Gemini is selected but no API key is set
    if req.model == "Local Minimax" or not api_key:
        if req.model != "Local Minimax" and not api_key:
            # Explicitly selected Gemini but no API key is set
            raise HTTPException(
                status_code=400, 
                detail="GEMINI_API_KEY is not set. Please configure your API key in the sidebar settings or select the 'Local Minimax' engine."
            )
            
        try:
            import chess
            import re
            
            # Extract FEN from the prompt
            fen_match = re.search(r"Current FEN:\s*(\S+ \S+ \S+ \S+ \S+ \S+)", req.prompt)
            if fen_match:
                fen = fen_match.group(1)
            else:
                fen_match = re.search(r"Current FEN:\s*([^\n\r]+)", req.prompt)
                fen = fen_match.group(1).strip() if fen_match else None
            
            if not fen:
                board = chess.Board()
            else:
                board = chess.Board(fen)
                
            PIECE_VALUES = {
                chess.PAWN: 100,
                chess.KNIGHT: 320,
                chess.BISHOP: 330,
                chess.ROOK: 500,
                chess.QUEEN: 900,
                chess.KING: 20000
            }
            
            def evaluate_board(b):
                val = 0
                for sq in chess.SQUARES:
                    piece = b.piece_at(sq)
                    if piece:
                        piece_val = PIECE_VALUES[piece.piece_type]
                        if piece.color == chess.WHITE:
                            val += piece_val
                        else:
                            val -= piece_val
                return val
            
            def minimax(b, depth, alpha, beta, maximizing_player):
                if depth == 0 or b.is_game_over():
                    return evaluate_board(b), None
                
                best_move = None
                if maximizing_player:
                    max_eval = -float('inf')
                    for move in b.legal_moves:
                        b.push(move)
                        eval_val, _ = minimax(b, depth - 1, alpha, beta, False)
                        b.pop()
                        if eval_val > max_eval:
                            max_eval = eval_val
                            best_move = move
                        alpha = max(alpha, eval_val)
                        if beta <= alpha:
                            break
                    return max_eval, best_move
                else:
                    min_eval = float('inf')
                    for move in b.legal_moves:
                        b.push(move)
                        eval_val, _ = minimax(b, depth - 1, alpha, beta, True)
                        b.pop()
                        if eval_val < min_eval:
                            min_eval = eval_val
                            best_move = move
                        beta = min(beta, eval_val)
                        if beta <= alpha:
                            break
                    return min_eval, best_move
            
            is_white = board.turn == chess.WHITE
            _, best_move = minimax(board, 3, -float('inf'), float('inf'), is_white)
            
            if best_move:
                san_move = board.san(best_move)
                return {"text": san_move}
            else:
                return {"text": ""}
        except Exception as e:
            import random
            import chess
            try:
                board = chess.Board()
                fen_match = re.search(r"Current FEN:\s*(\S+ \S+ \S+ \S+ \S+ \S+)", req.prompt)
                if fen_match:
                    board = chess.Board(fen_match.group(1))
                legal_moves = list(board.legal_moves)
                if legal_moves:
                    return {"text": board.san(random.choice(legal_moves))}
            except:
                pass
            raise HTTPException(status_code=500, detail=f"Local engine error: {e}")

    # Map friendly model names to official API model IDs
    model_mapping = {
        "Gemini 2.5 Flash": "gemini-2.5-flash",
        "Gemini 1.5 Pro": "gemini-1.5-pro",
        "Gemini 1.5 Flash": "gemini-1.5-flash"
    }
    gemini_model = model_mapping.get(req.model, "gemini-2.5-flash")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent?key={api_key}"
    
    payload = {
        "contents": [{"parts": [{"text": req.prompt}]}],
        "systemInstruction": {
            "parts": [{
                "text": f"You are {req.persona}. Read the PGN/FEN and instructions carefully. Output strictly what is asked with no conversational filler."
            }]
        }
    }
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(url, json=payload, timeout=30.0)
            response.raise_for_status()
            data = response.json()
            
            if "candidates" in data and len(data["candidates"]) > 0:
                text = data["candidates"][0]["content"]["parts"][0]["text"]
                return {"text": text}
            else:
                return {"text": "No content generated."}
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=e.response.status_code, detail=f"Google API Error: {e}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
