// --- Gemini API via Backend ---
async function fetchGeminiContent(promptText, modelPersona = "an expert chess engine") {
    const url = `/api/generate`;
    const payload = {
        prompt: promptText,
        persona: modelPersona
    };

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if(result.text) {
                return result.text;
            }
        } catch (e) {
            await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
        }
    }
    throw new Error("Failed to reach backend API");
}

// --- UI State & Navigation ---
let currentMode = 'anonymous';
let isDropdownOpen = false;
let isSidebarOpen = false;
let gameConfig = {};

function toggleSidebar() {
    isSidebarOpen = !isSidebarOpen;
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    
    if (isSidebarOpen) {
        sidebar.classList.remove('-translate-x-full');
        backdrop.classList.remove('hidden');
        // Small delay to allow display:block to apply before animating opacity
        setTimeout(() => backdrop.classList.remove('opacity-0'), 10);
    } else {
        sidebar.classList.add('-translate-x-full');
        backdrop.classList.add('opacity-0');
        setTimeout(() => backdrop.classList.add('hidden'), 300);
    }
}

function resetNav() {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById('view-landing').classList.add('hidden');
    document.getElementById('view-arena').classList.add('hidden');
    document.getElementById('view-leaderboard').classList.add('hidden');
}

function showLanding() {
    resetNav();
    document.getElementById('nav-new').classList.add('active');
    document.getElementById('view-landing').classList.remove('hidden');
}

function showLeaderboard() {
    resetNav();
    document.getElementById('nav-leaderboard').classList.add('active');
    document.getElementById('view-leaderboard').classList.remove('hidden');
}

function toggleDropdown() {
    isDropdownOpen = !isDropdownOpen;
    document.getElementById('modeDropdownMenu').classList.toggle('hidden', !isDropdownOpen);
}

document.addEventListener('click', (e) => {
    if (!document.getElementById('modeDropdownBtn').contains(e.target) && 
        !document.getElementById('modeDropdownMenu').contains(e.target)) {
        document.getElementById('modeDropdownMenu').classList.add('hidden');
        isDropdownOpen = false;
    }
});

function selectMode(modeId, title) {
    currentMode = modeId;
    document.getElementById('currentModeLabel').innerText = title;
    toggleDropdown();

    // In spectate mode, default models are provided if none exist
    if(modeId === 'spectate' && !gameConfig.spectateWhite) {
        gameConfig = {
            spectateWhite: 'Gemini 2.5 Flash',
            spectateBlack: 'Gemini 1.5 Pro'
        };
    }

    if(modeId !== 'battle' || gameConfig.opponentName) startGame(gameConfig);
    else showLanding(); // If selected battle but no model, show landing to select
}

function startDirectBattle() {
    currentMode = 'battle';
    document.getElementById('currentModeLabel').innerText = 'Direct Battle';
    startGame({
        opponentName: document.getElementById('direct-model-select').value
    });
}

function startSpectateBattle() {
    currentMode = 'spectate';
    document.getElementById('currentModeLabel').innerText = 'Spectate Battle';
    startGame({
        spectateWhite: document.getElementById('spectate-white').value,
        spectateBlack: document.getElementById('spectate-black').value
    });
}

// --- Chess Game State & Animation ---
let game = new Chess();
let canvas, ctx;
let selectedSquare = null;
let isAITurn = false;
let aiThinking = false;

// Animation Variables
let animationLoopRunning = false;
let animationState = null;

const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

function updateGameConfig(key, value) {
    gameConfig[key] = value;
}

function setLabels() {
    const oppContainer = document.getElementById('opponent-name-container');
    const playerContainer = document.getElementById('player-name-container');
    const playerIcon = document.getElementById('player-icon');
    const btnAction = document.getElementById('btn-action');
    const btnResign = document.getElementById('btn-resign');

    // Default Resets
    playerIcon.innerHTML = "U";
    
    let oppHTML = `<span id="opponent-name">Anonymous Model</span>`;
    let playerHTML = `<span id="player-name">You</span>`;

    if(currentMode === 'anonymous') {
        oppHTML = `<span id="opponent-name">Anonymous Model</span>`;
    } 
    else if (currentMode === 'battle') {
        const currentModel = gameConfig.opponentName || "Gemini 2.5 Flash";
        oppHTML = `
            <select onchange="updateGameConfig('opponentName', this.value)" class="bg-transparent border border-stone-300 rounded px-2 py-1 outline-none focus:border-stone-500 font-medium text-stone-700 cursor-pointer">
                <option value="Gemini 2.5 Flash" ${currentModel === 'Gemini 2.5 Flash' ? 'selected' : ''}>Gemini 2.5 Flash</option>
                <option value="Gemini 1.5 Pro" ${currentModel === 'Gemini 1.5 Pro' ? 'selected' : ''}>Gemini 1.5 Pro</option>
                <option value="Gemini 1.5 Flash" ${currentModel === 'Gemini 1.5 Flash' ? 'selected' : ''}>Gemini 1.5 Flash</option>
            </select>
        `;
    }
    else if (currentMode === 'spectate') {
        const bModel = gameConfig.spectateBlack || "Gemini 1.5 Pro";
        const wModel = gameConfig.spectateWhite || "Gemini 2.5 Flash";
        
        playerIcon.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;
        
        oppHTML = `
            <select onchange="updateGameConfig('spectateBlack', this.value)" class="bg-transparent border border-stone-300 rounded px-2 py-1 outline-none focus:border-stone-500 font-medium text-stone-700 text-xs cursor-pointer">
                <option value="Gemini 2.5 Flash" ${bModel === 'Gemini 2.5 Flash' ? 'selected' : ''}>Gemini 2.5 Flash</option>
                <option value="Gemini 1.5 Pro" ${bModel === 'Gemini 1.5 Pro' ? 'selected' : ''}>Gemini 1.5 Pro</option>
                <option value="Gemini 1.5 Flash" ${bModel === 'Gemini 1.5 Flash' ? 'selected' : ''}>Gemini 1.5 Flash</option>
            </select>
        `;
        
        playerHTML = `
            <select onchange="updateGameConfig('spectateWhite', this.value)" class="bg-transparent border border-stone-300 rounded px-2 py-1 outline-none focus:border-stone-500 font-medium text-stone-800 text-xs cursor-pointer">
                <option value="Gemini 2.5 Flash" ${wModel === 'Gemini 2.5 Flash' ? 'selected' : ''}>Gemini 2.5 Flash</option>
                <option value="Gemini 1.5 Pro" ${wModel === 'Gemini 1.5 Pro' ? 'selected' : ''}>Gemini 1.5 Pro</option>
                <option value="Gemini 1.5 Flash" ${wModel === 'Gemini 1.5 Flash' ? 'selected' : ''}>Gemini 1.5 Flash</option>
            </select>
        `;
        btnAction.classList.remove('hidden');
        btnResign.classList.add('hidden');
    }
    else if (currentMode === 'learn') {
        oppHTML = `<span id="opponent-name">Gemini Coach</span>`;
    }
    else if (currentMode === 'random') {
        oppHTML = `<span id="opponent-name">Random Model</span>`;
    }

    oppContainer.innerHTML = oppHTML;
    playerContainer.innerHTML = playerHTML;

    if(currentMode !== 'spectate') {
        btnAction.classList.add('hidden');
        btnResign.classList.remove('hidden');
    }
}

function startGame(config = {}) {
    resetNav();
    document.getElementById('nav-new').classList.add('active');
    document.getElementById('view-arena').classList.remove('hidden');
    
    gameConfig = config;
    game = new Chess();
    
    if(currentMode === 'random') {
        const randomFens = [
            "r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQ1RK1 w - - 6 6",
            "r1bqk2r/pppp1ppp/2n2n2/2b1p3/4P3/2N2N2/PPPP1PPP/R1BQKB1R w KQkq - 4 5",
            "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",
            "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2",
            "rnbqkb1r/pppppppp/5n2/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 1 2",
            "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2"
        ];
        game.load(randomFens[Math.floor(Math.random() * randomFens.length)]);
    }

    document.getElementById('learn-chat-panel').classList.toggle('hidden', currentMode !== 'learn');
    document.getElementById('learn-chat-panel').classList.toggle('flex', currentMode === 'learn');
    document.getElementById('chat-messages').innerHTML = `<div class="chat-bubble chat-ai">Hello! I am your AI Coach. Make a move, or click "Ask for Hint".</div>`;

    setLabels();
    initCanvas();
    
    isAITurn = false;
    aiThinking = false;
    selectedSquare = null;
    animationState = null;
}

// --- Canvas Rendering with Animation Loop ---

const pieceUnicode = {
    'w': { 'p': '♙', 'n': '♘', 'b': '♗', 'r': '♖', 'q': '♕', 'k': '♔' },
    'b': { 'p': '♟', 'n': '♞', 'b': '♝', 'r': '♜', 'q': '♛', 'k': '♚' }
};

function initCanvas() {
    canvas = document.getElementById('chessCanvas');
    if(!canvas) return;
    ctx = canvas.getContext('2d');
    const container = document.getElementById('canvas-container');
    
    const dpr = window.devicePixelRatio || 1;
    
    const resize = () => {
        if(!container.offsetWidth) return;
        const rect = container.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
    };
    
    window.removeEventListener('resize', resize);
    window.addEventListener('resize', resize);
    resize();
    
    canvas.onclick = handleBoardClick;

    // Start continuous render loop for animations
    if (!animationLoopRunning) {
        animationLoopRunning = true;
        function loop() {
            drawBoard();
            requestAnimationFrame(loop);
        }
        loop();
    }
}

function drawBoard() {
    if(!ctx || !canvas.width) return;
    
    const size = canvas.width / (window.devicePixelRatio || 1);
    const sqSize = size / 8;
    
    ctx.clearRect(0, 0, size, size);
    
    const lightCol = '#f3f4f6', darkCol = '#d1d5db', highlightCol = 'rgba(234, 179, 8, 0.4)';
    const board = game.board();

    // Calculate active animation physics
    let animProgress = 0;
    let animX = 0, animY = 0;
    if (animationState) {
        animProgress = (Date.now() - animationState.startTime) / animationState.duration;
        if (animProgress >= 1) {
            animationState = null; // Animation complete
        } else {
            // Ease out quadratic
            const ease = 1 - Math.pow(1 - animProgress, 3);
            animX = animationState.fromX + (animationState.toX - animationState.fromX) * ease;
            animY = animationState.fromY + (animationState.toY - animationState.fromY) * ease;
        }
    }

    // 1. Draw Squares & Highlights
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const squareId = files[col] + (8 - row);
            
            ctx.fillStyle = (row + col) % 2 === 0 ? lightCol : darkCol;
            ctx.fillRect(col * sqSize, row * sqSize, sqSize, sqSize);
            
            // Selected square highlight
            if(selectedSquare === squareId) {
                ctx.fillStyle = highlightCol;
                ctx.fillRect(col * sqSize, row * sqSize, sqSize, sqSize);
            }
            
            // Last move highlight
            const history = game.history({verbose: true});
            if (history.length > 0) {
                const lastMove = history[history.length - 1];
                if (lastMove.from === squareId || lastMove.to === squareId) {
                    ctx.fillStyle = 'rgba(234, 179, 8, 0.2)';
                    ctx.fillRect(col * sqSize, row * sqSize, sqSize, sqSize);
                }
            }

            // Coordinates
            if (col === 0) {
                ctx.fillStyle = (row + col) % 2 === 0 ? darkCol : lightCol;
                ctx.font = '10px Inter';
                ctx.fillText(8 - row, 4, row * sqSize + 14);
            }
            if (row === 7) {
                ctx.fillStyle = (row + col) % 2 === 0 ? darkCol : lightCol;
                ctx.font = '10px Inter';
                ctx.fillText(files[col], col * sqSize + sqSize - 10, size - 4);
            }
        }
    }

    // 2. Draw Valid Move Indicators (Animated Pulse)
    if (selectedSquare && !animationState) {
        const moves = game.moves({ square: selectedSquare, verbose: true });
        
        // Calculate pulsing opacity (0.3 to 0.7)
        const pulse = (Math.sin(Date.now() / 150) + 1) / 2;
        const alpha = 0.3 + (pulse * 0.4);

        moves.forEach(m => {
            const tCol = files.indexOf(m.to.charAt(0));
            const tRow = 8 - parseInt(m.to.charAt(1));
            
            const cx = tCol * sqSize + sqSize/2;
            const cy = tRow * sqSize + sqSize/2;
            
            ctx.beginPath();
            if (m.flags.includes('c') || m.flags.includes('e')) {
                // Capture move: Draw hollow ring
                ctx.arc(cx, cy, sqSize * 0.35, 0, 2 * Math.PI);
                ctx.lineWidth = sqSize * 0.08;
                ctx.strokeStyle = `rgba(0, 0, 0, ${alpha})`;
                ctx.stroke();
            } else {
                // Normal move: Draw solid dot
                ctx.arc(cx, cy, sqSize * 0.15, 0, 2 * Math.PI);
                ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
                ctx.fill();
            }
        });
    }

    // 3. Draw Static Pieces
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const squareId = files[col] + (8 - row);
            const piece = board[row][col];
            
            // Hide the piece if it is currently the destination of an active animation
            if (animationState && animationState.toSq === squareId) continue;
            
            if (piece) {
                drawPieceSymbol(piece.color, piece.type, col * sqSize, row * sqSize, sqSize);
            }
        }
    }

    // 4. Draw Animating Piece on Top
    if (animationState) {
        drawPieceSymbol(animationState.color, animationState.piece, animX, animY, sqSize);
    }
}

function drawPieceSymbol(color, type, x, y, size) {
    const symbol = pieceUnicode[color][type];
    const isWhite = color === 'w';
    
    ctx.fillStyle = isWhite ? '#ffffff' : '#1c1917';
    ctx.strokeStyle = isWhite ? '#1c1917' : '#ffffff';
    ctx.lineWidth = size * 0.02;
    ctx.font = `${size * 0.75}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    ctx.fillText(symbol, x + size/2, y + size/2 + size*0.05);
    if(isWhite) ctx.strokeText(symbol, x + size/2, y + size/2 + size*0.05);
}

// --- Core Movement Logic ---

function executeMove(moveInput) {
    const moveObj = typeof moveInput === 'string' ? game.move(moveInput) : game.move(moveInput);
    
    if (moveObj) {
        const size = canvas.width / (window.devicePixelRatio || 1);
        const sqSize = size / 8;
        
        const fromCol = files.indexOf(moveObj.from.charAt(0));
        const fromRow = 8 - parseInt(moveObj.from.charAt(1));
        const toCol = files.indexOf(moveObj.to.charAt(0));
        const toRow = 8 - parseInt(moveObj.to.charAt(1));

        // Set up the animation physics block
        animationState = {
            fromSq: moveObj.from,
            toSq: moveObj.to,
            fromX: fromCol * sqSize,
            fromY: fromRow * sqSize,
            toX: toCol * sqSize,
            toY: toRow * sqSize,
            piece: moveObj.piece, // E.g., 'p' animating before promoting to 'q'
            color: moveObj.color,
            startTime: Date.now(),
            duration: 250 // Slide animation length in ms
        };
        
        selectedSquare = null;
        checkGameOver();
        return moveObj;
    }
    return null;
}

function handleBoardClick(e) {
    // Prevent interaction during AI turn or while pieces are actively sliding
    if(isAITurn || aiThinking || currentMode === 'spectate' || game.game_over() || animationState) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const sqSize = rect.width / 8;
    const col = Math.floor(x / sqSize);
    const row = Math.floor(y / sqSize);
    
    const clickedSquare = files[col] + (8 - row);
    
    if(selectedSquare) {
        // Determine if click is a valid move
        const moves = game.moves({ square: selectedSquare, verbose: true });
        const validMove = moves.find(m => m.to === clickedSquare);
        
        if (validMove) {
            const move = executeMove({ from: selectedSquare, to: clickedSquare, promotion: 'q' });
            if (move && !game.game_over()) {
                // Small delay before AI move so user can see piece land
                setTimeout(triggerAIMove, 400); 
            }
        } else {
            // Clicked an invalid square; re-select if it's our own piece, else deselect
            const piece = game.get(clickedSquare);
            if (piece && piece.color === game.turn()) {
                selectedSquare = clickedSquare;
            } else {
                selectedSquare = null;
            }
        }
    } else {
        // Select a piece
        const piece = game.get(clickedSquare);
        if (piece && piece.color === game.turn()) {
            selectedSquare = clickedSquare;
        }
    }
}

function addChat(msg, isUser=false) {
    const chat = document.getElementById('chat-messages');
    chat.innerHTML += `<div class="chat-bubble ${isUser ? 'chat-user' : 'chat-ai'}">${msg}</div>`;
    chat.scrollTop = chat.scrollHeight;
}

async function triggerAIMove() {
    if(game.game_over()) return;
    
    aiThinking = true;
    isAITurn = true;
    selectedSquare = null;
    
    const indicator = document.getElementById('ai-thinking-indicator');
    if(indicator) indicator.classList.remove('hidden');

    try {
        // Determine Persona based on mode
        let persona = "an expert chess engine";
        if(currentMode === 'battle') persona = gameConfig.opponentName;
        if(currentMode === 'spectate') persona = game.turn() === 'w' ? gameConfig.spectateWhite : gameConfig.spectateBlack;

        // Ask Gemini for a move
        const prompt = `Current Chess PGN:\n${game.pgn()}\nCurrent FEN:\n${game.fen()}\nIt is ${game.turn() === 'w' ? 'White' : 'Black'}'s turn. What is the single best next move? Output ONLY the move in Standard Algebraic Notation (SAN), like Nf3 or e4.`;
        
        const aiResponse = await fetchGeminiContent(prompt, persona);
        const predictedMove = aiResponse.trim();
        
        const moveObj = executeMove(predictedMove);
        if(!moveObj) throw new Error("Gemini produced an invalid move: " + predictedMove);

        if(currentMode === 'learn') {
            addChat(`I played <strong>${predictedMove}</strong>. Your turn!`);
        }
    } catch (err) {
        console.warn("AI failed or hallucinated. Falling back to engine logic.", err);
        // Fallback: Random legal move if LLM hallucinates
        const moves = game.moves();
        const randomMove = moves[Math.floor(Math.random() * moves.length)];
        executeMove(randomMove);
    }
    
    if(indicator) indicator.classList.add('hidden');
    aiThinking = false;
    if(currentMode !== 'spectate') isAITurn = false;
}

async function askCoachForHint() {
    if(aiThinking || game.game_over()) return;
    
    aiThinking = true;
    addChat("Can you give me a hint?", true);
    addChat(`<span class="thinking-dot">.</span><span class="thinking-dot">.</span><span class="thinking-dot">.</span>`, false);
    
    try {
        const prompt = `You are a helpful chess coach. Look at this game:
FEN: ${game.fen()}
It is ${game.turn() === 'w' ? 'White' : 'Black'}'s turn. 
Suggest the best move in SAN format and explain why in 1-2 short sentences. Format:
MOVE: [move]
REASON: [reason]`;
        
        const response = await fetchGeminiContent(prompt, "a helpful chess coach");
        
        // Remove the loading dots
        const chat = document.getElementById('chat-messages');
        chat.removeChild(chat.lastChild);
        
        // Parse response
        const lines = response.split('\n');
        let move = "a good move";
        let reason = response;
        
        lines.forEach(l => {
            if(l.toUpperCase().startsWith("MOVE:")) move = l.replace(/MOVE:/i, '').trim();
            if(l.toUpperCase().startsWith("REASON:")) reason = l.replace(/REASON:/i, '').trim();
        });
        
        addChat(`I suggest looking at <strong>${move}</strong>.<br><br>${reason}`);
        
    } catch (e) {
        const chat = document.getElementById('chat-messages');
        chat.removeChild(chat.lastChild);
        addChat("Sorry, I'm having trouble analyzing the board right now.");
    }
    
    aiThinking = false;
}

function checkGameOver() {
    if (game.game_over()) {
        let status = "Game Over";
        if (game.in_checkmate()) status = `Checkmate! ${game.turn() === 'w' ? 'Black' : 'White'} wins.`;
        else if (game.in_draw()) status = "Draw!";
        else if (game.in_stalemate()) status = "Stalemate!";
        
        setTimeout(() => {
            if(currentMode === 'anonymous') {
                alert(`${status}\n\nYou were playing against: Gemini 2.5 Flash!`);
            } else {
                alert(status);
            }
        }, 400); // Wait for animation to finish
    }
}

window.onload = () => showLanding();
