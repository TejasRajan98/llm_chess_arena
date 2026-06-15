// --- Gemini API via Backend ---
async function fetchGeminiContent(promptText, modelPersona = "an expert chess engine", modelName = "Gemini 2.5 Flash") {
    const url = `/api/generate`;
    const localKey = localStorage.getItem('user_gemini_api_key') || '';
    const payload = {
        prompt: promptText,
        persona: modelPersona,
        model: modelName,
        apiKey: localKey
    };

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.detail || "Server error");
            }
            
            const result = await response.json();
            if(result.text) {
                return result.text;
            }
        } catch (e) {
            if (e.message.includes("GEMINI_API_KEY")) {
                throw e; // Don't retry on missing API key configuration
            }
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

// Review State Variables
let initialFen = '';
let currentReviewIndex = -1;
let stockfishWorker = null;
let analysisData = null;
let isAnalyzing = false;
let analysisWorker = null;
let activeEvalReject = null;
let isResigned = false;

// Autoplay Variables for Spectator Mode
let autoplayInterval = null;
let isAutoplayRunning = false;

function toggleAutoplay() {
    isAutoplayRunning = !isAutoplayRunning;
    const btnAutoplay = document.getElementById('btn-autoplay');
    const autoplayIcon = document.getElementById('autoplay-icon');
    const autoplayText = document.getElementById('autoplay-text');
    
    if (!btnAutoplay || !autoplayIcon || !autoplayText) return;
    
    if (isAutoplayRunning) {
        btnAutoplay.className = "bg-red-50 hover:bg-red-100 text-red-700 px-2 py-0.5 rounded border border-red-200 transition-colors select-none font-medium flex items-center gap-1";
        autoplayIcon.innerHTML = `<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>`;
        autoplayText.innerText = "Pause";
        
        runAutoplayNext();
    } else {
        btnAutoplay.className = "bg-stone-100 hover:bg-stone-200 text-stone-700 px-2 py-0.5 rounded border border-stone-300 transition-colors select-none font-medium flex items-center gap-1";
        autoplayIcon.innerHTML = `<polygon points="5 3 19 12 5 21 5 3"></polygon>`;
        autoplayText.innerText = "Auto Play";
        
        if (autoplayInterval) {
            clearTimeout(autoplayInterval);
            autoplayInterval = null;
        }
    }
}

function runAutoplayNext() {
    if (!isAutoplayRunning || game.game_over() || currentMode !== 'spectate') {
        if (isAutoplayRunning) toggleAutoplay();
        return;
    }
    
    triggerAIMove().then(() => {
        if (isAutoplayRunning) {
            autoplayInterval = setTimeout(runAutoplayNext, 1200);
        }
    }).catch(() => {
        if (isAutoplayRunning) toggleAutoplay();
    });
}

function getReviewBoard() {
    if (currentReviewIndex === -1) {
        return game;
    }
    const tempGame = new Chess(initialFen);
    const history = game.history({ verbose: true });
    // Apply moves up to currentReviewIndex
    for (let i = 0; i < currentReviewIndex; i++) {
        tempGame.move(history[i]);
    }
    return tempGame;
}

function navigateHistory(direction) {
    const history = game.history();
    if (history.length === 0) return;
    
    if (currentReviewIndex === -1) {
        if (direction === -1) {
            currentReviewIndex = history.length - 1;
        }
    } else {
        let nextIndex = currentReviewIndex + direction;
        if (nextIndex < 0) {
            nextIndex = 0;
        }
        if (nextIndex >= history.length) {
            currentReviewIndex = -1; // back to live game
        } else {
            currentReviewIndex = nextIndex;
        }
    }
    
    updateReviewUI();
}

function exitReviewMode() {
    currentReviewIndex = -1;
    updateReviewUI();
}

function updateMaterialScores() {
    const oppScore = document.getElementById('opponent-score-diff');
    const playerScore = document.getElementById('player-score-diff');
    if (!oppScore || !playerScore) return;

    const activeBoard = getReviewBoard();
    const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    let whiteScore = 0;
    let blackScore = 0;

    const board = activeBoard.board();
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = board[r][c];
            if (piece) {
                const val = values[piece.type] || 0;
                if (piece.color === 'w') whiteScore += val;
                else blackScore += val;
            }
        }
    }

    const diff = whiteScore - blackScore;
    if (diff > 0) {
        playerScore.innerText = `+${diff}`;
        playerScore.className = "text-[10px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.25 rounded-md animate-fade-in";
        oppScore.className = "hidden text-[10px]";
    } else if (diff < 0) {
        oppScore.innerText = `+${Math.abs(diff)}`;
        oppScore.className = "text-[10px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.25 rounded-md animate-fade-in";
        playerScore.className = "hidden text-[10px]";
    } else {
        playerScore.innerText = "0";
        playerScore.className = "text-[10px] bg-stone-100 text-stone-400 font-medium px-1.5 py-0.25 rounded-md";
        oppScore.innerText = "0";
        oppScore.className = "text-[10px] bg-stone-100 text-stone-400 font-medium px-1.5 py-0.25 rounded-md";
    }
}

function updateReviewUI() {
    const reviewBar = document.getElementById('review-bar');
    const statusText = document.getElementById('review-status');
    const pulseDot = document.getElementById('review-pulse');
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    const btnLive = document.getElementById('btn-live');
    const history = game.history();
    
    if (!reviewBar || !statusText || !pulseDot || !btnPrev || !btnNext || !btnLive) return;
    
    updateMaterialScores();
    
    const evalBar = document.getElementById('eval-bar-container');

    if (currentReviewIndex === -1) {
        // Reset classes to neutral/live theme
        reviewBar.className = "w-full flex items-center justify-between mt-2.5 px-3 py-1.5 bg-stone-50 border border-stone-200 rounded-lg text-xs text-stone-600 font-medium transition-all duration-200";
        pulseDot.className = "w-1.5 h-1.5 rounded-full bg-emerald-500";
        statusText.innerHTML = "Live Game";
        
        btnPrev.disabled = history.length === 0;
        btnNext.disabled = true;
        btnLive.disabled = true;

        if (evalBar) {
            if (currentMode === 'spectate' || currentMode === 'learn') {
                evalBar.style.display = 'flex';
                // Query Stockfish for live FEN evaluation
                getStockfishEval(game.fen(), 6).then(res => {
                    updateEvalBar(res.score, res.isMate, game.turn());
                }).catch(console.error);
            } else {
                evalBar.style.display = 'none';
            }
        }
    } else {
        // Switch to warm/alert theme for review
        reviewBar.className = "w-full flex items-center justify-between mt-2.5 px-3 py-1.5 bg-amber-50 border border-amber-200/60 rounded-lg text-xs text-amber-800 font-medium transition-all duration-200";
        pulseDot.className = "w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse";
        
        if (currentReviewIndex === 0) {
            statusText.innerHTML = `Reviewing: <strong>Starting Position</strong> (Move 0 of ${history.length})`;
        } else {
            statusText.innerHTML = `Reviewing: Move <strong>${currentReviewIndex}</strong> of <strong>${history.length}</strong>`;
        }
        
        btnPrev.disabled = currentReviewIndex === 0;
        btnNext.disabled = false;
        btnLive.disabled = false;

        if (evalBar) {
            evalBar.style.display = 'flex';
            if (analysisData) {
                const currEval = analysisData.evaluations[currentReviewIndex];
                if (currEval) {
                    updateEvalBar(currEval.score, currEval.isMate, currEval.turn);
                }
            } else {
                const renderGame = getReviewBoard();
                getStockfishEval(renderGame.fen(), 6).then(res => {
                    updateEvalBar(res.score, res.isMate, renderGame.turn());
                }).catch(console.error);
            }
        }

        // Highlight active move in review list
        const activeMoves = document.querySelectorAll('#analysis-move-list > div > div');
        activeMoves.forEach(m => m.classList.remove('bg-emerald-50', 'text-emerald-900', 'font-bold'));
        if (currentReviewIndex > 0) {
            const listItems = document.querySelectorAll('#analysis-move-list > div');
            const rowIndex = Math.floor((currentReviewIndex - 1) / 2);
            const isBlack = (currentReviewIndex - 1) % 2 === 1;
            
            if (listItems[rowIndex]) {
                const moveDiv = listItems[rowIndex].querySelectorAll('div')[isBlack ? 1 : 0];
                if (moveDiv) {
                    moveDiv.classList.add('bg-emerald-50', 'text-emerald-900', 'font-bold');
                    // Scroll container only, without shifting the browser window page scroll
                    const container = document.getElementById('analysis-move-list');
                    if (container) {
                        const containerRect = container.getBoundingClientRect();
                        const elemRect = moveDiv.getBoundingClientRect();
                        
                        const elemTop = elemRect.top - containerRect.top + container.scrollTop;
                        const elemBottom = elemTop + elemRect.height;
                        
                        const containerTop = container.scrollTop;
                        const containerBottom = containerTop + container.clientHeight;
                        
                        if (elemTop < containerTop) {
                            container.scrollTop = elemTop;
                        } else if (elemBottom > containerBottom) {
                            container.scrollTop = elemBottom - container.clientHeight;
                        }
                    }
                }
            }
        }
    }
}

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
    const btnResign = document.getElementById('btn-resign');
    const spectateControls = document.getElementById('spectate-controls');

    // Default Resets
    playerIcon.innerHTML = "U";
    if (spectateControls) {
        spectateControls.classList.add('hidden');
        spectateControls.classList.remove('flex');
    }
    
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
                <option value="Stockfish" ${currentModel === 'Stockfish' ? 'selected' : ''}>Stockfish</option>
                <option value="Local Minimax" ${currentModel === 'Local Minimax' ? 'selected' : ''}>Local Minimax</option>
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
                <option value="Stockfish" ${bModel === 'Stockfish' ? 'selected' : ''}>Stockfish</option>
                <option value="Local Minimax" ${bModel === 'Local Minimax' ? 'selected' : ''}>Local Minimax</option>
            </select>
        `;
        
        playerHTML = `
            <select onchange="updateGameConfig('spectateWhite', this.value)" class="bg-transparent border border-stone-300 rounded px-2 py-1 outline-none focus:border-stone-500 font-medium text-stone-800 text-xs cursor-pointer">
                <option value="Gemini 2.5 Flash" ${wModel === 'Gemini 2.5 Flash' ? 'selected' : ''}>Gemini 2.5 Flash</option>
                <option value="Gemini 1.5 Pro" ${wModel === 'Gemini 1.5 Pro' ? 'selected' : ''}>Gemini 1.5 Pro</option>
                <option value="Gemini 1.5 Flash" ${wModel === 'Gemini 1.5 Flash' ? 'selected' : ''}>Gemini 1.5 Flash</option>
                <option value="Stockfish" ${wModel === 'Stockfish' ? 'selected' : ''}>Stockfish</option>
                <option value="Local Minimax" ${wModel === 'Local Minimax' ? 'selected' : ''}>Local Minimax</option>
            </select>
        `;
        if (spectateControls) {
            spectateControls.classList.remove('hidden');
            spectateControls.classList.add('flex');
        }
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

    if (isAutoplayRunning) {
        toggleAutoplay();
    }

    // Terminate any active analysis worker and reset states
    if (activeEvalReject) {
        try { activeEvalReject(new Error("Analysis cancelled")); } catch(e){}
        activeEvalReject = null;
    }
    if (analysisWorker) {
        try { analysisWorker.terminate(); } catch(e){}
        analysisWorker = null;
    }
    isAnalyzing = false;
    analysisData = null;
    isResigned = false;

    // Reset Review Panel Views
    const reviewPanel = document.getElementById('game-review-panel');
    if (reviewPanel) {
        reviewPanel.classList.add('hidden');
        reviewPanel.classList.remove('flex');
    }
    const welcomeView = document.getElementById('analysis-welcome');
    const resultsView = document.getElementById('analysis-results');
    const progressView = document.getElementById('analysis-progress-container');
    if (welcomeView) welcomeView.classList.remove('hidden');
    if (resultsView) resultsView.classList.add('hidden');
    if (progressView) progressView.classList.add('hidden');

    const btnReview = document.getElementById('btn-review');
    if (btnReview) btnReview.classList.add('hidden');

    initialFen = game.fen();
    currentReviewIndex = -1;
    updateReviewUI();

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
    const renderGame = getReviewBoard();
    const board = renderGame.board();

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
            const history = renderGame.history({verbose: true});
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
        const moves = renderGame.moves({ square: selectedSquare, verbose: true });
        
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
    let parsedInput = moveInput;
    if (typeof moveInput === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(moveInput)) {
        parsedInput = {
            from: moveInput.slice(0, 2),
            to: moveInput.slice(2, 4),
            promotion: moveInput.length > 4 ? moveInput.charAt(4) : undefined
        };
    }
    const moveObj = game.move(parsedInput);
    
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
        updateReviewUI();
        return moveObj;
    }
    return null;
}

function handleBoardClick(e) {
    // Prevent interaction during AI turn or while pieces are actively sliding or in review mode
    if(isAITurn || aiThinking || currentMode === 'spectate' || game.game_over() || isResigned || animationState || currentReviewIndex !== -1) return;
    
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

function getStockfishMove(fen, depth = 10) {
    return new Promise(async (resolve, reject) => {
        if (!stockfishWorker) {
            try {
                // Try local worker first
                stockfishWorker = new Worker('/static/js/stockfish.js?v=1.0.9');
            } catch (e) {
                // Fallback to CDN Blob URL (useful for standalone file:// context or CORS bypass)
                console.warn("Local worker instantiation failed, trying CDN blob worker...", e);
                try {
                    const cdnUrl = 'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js';
                    const response = await fetch(cdnUrl);
                    const scriptText = await response.text();
                    const blob = new Blob([scriptText], { type: 'application/javascript' });
                    const blobUrl = URL.createObjectURL(blob);
                    stockfishWorker = new Worker(blobUrl);
                } catch (cdnErr) {
                    reject(new Error("Failed to initialize Stockfish.js worker (Local & CDN fallbacks failed): " + cdnErr.message));
                    return;
                }
            }
        }

        const onMessage = (e) => {
            const line = e.data;
            if (line.startsWith('bestmove')) {
                const parts = line.split(' ');
                const bestMove = parts[1];
                stockfishWorker.removeEventListener('message', onMessage);
                if (bestMove && bestMove !== '(none)') {
                    resolve(bestMove);
                } else {
                    reject(new Error("Stockfish returned no bestmove"));
                }
            }
        };

        stockfishWorker.addEventListener('message', onMessage);

        stockfishWorker.postMessage('uci');
        stockfishWorker.postMessage('isready');
        stockfishWorker.postMessage(`position fen ${fen}`);
        stockfishWorker.postMessage(`go depth ${depth}`);
    });
}

async function triggerAIMove() {
    if(game.game_over() || isResigned) return;
    
    aiThinking = true;
    isAITurn = true;
    selectedSquare = null;
    
    const indicator = document.getElementById('ai-thinking-indicator');
    if(indicator) indicator.classList.remove('hidden');

    try {
        // Determine Persona and Model based on mode
        let persona = "an expert chess engine";
        let modelSelected = "Gemini 2.5 Flash";
        
        if (currentMode === 'battle') {
            modelSelected = gameConfig.opponentName || "Gemini 2.5 Flash";
            persona = modelSelected;
        } else if (currentMode === 'spectate') {
            modelSelected = game.turn() === 'w' ? (gameConfig.spectateWhite || "Gemini 2.5 Flash") : (gameConfig.spectateBlack || "Gemini 1.5 Pro");
            persona = modelSelected;
        } else if (currentMode === 'learn') {
            persona = "Gemini Coach";
            modelSelected = "Gemini 2.5 Flash";
        } else if (currentMode === 'random') {
            persona = "Random Model";
            modelSelected = "Local Minimax";
        }

        let predictedMove;
        if (modelSelected === 'Stockfish') {
            predictedMove = await getStockfishMove(game.fen());
        } else {
            // Ask Gemini (or local engine fallback) for a move
            const prompt = `Current Chess PGN:\n${game.pgn()}\nPgn:${game.pgn()}\nCurrent FEN:\n${game.fen()}\nIt is ${game.turn() === 'w' ? 'White' : 'Black'}'s turn. What is the single best next move? Output ONLY the move in Standard Algebraic Notation (SAN), like Nf3 or e4.`;
            const aiResponse = await fetchGeminiContent(prompt, persona, modelSelected);
            predictedMove = aiResponse.trim();
        }
        
        const moveObj = executeMove(predictedMove);
        if(!moveObj) throw new Error(`${modelSelected} produced an invalid move: ` + predictedMove);

        if(currentMode === 'learn') {
            addChat(`I played <strong>${predictedMove}</strong>. Your turn!`);
        }
    } catch (err) {
        console.warn("AI failed or hallucinated. Falling back to engine logic.", err);
        if (err.message && err.message.includes("GEMINI_API_KEY")) {
            alert(err.message);
            // Cancel autoplay if active
            if (isAutoplayRunning) {
                toggleAutoplay();
            }
            if(indicator) indicator.classList.add('hidden');
            aiThinking = false;
            if(currentMode !== 'spectate') isAITurn = false;
            return;
        }
        // Fallback: Random legal move if LLM hallucinates
        const moves = game.moves();
        if (moves.length > 0) {
            const randomMove = moves[Math.floor(Math.random() * moves.length)];
            executeMove(randomMove);
        }
    }
    
    if(indicator) indicator.classList.add('hidden');
    aiThinking = false;
    if(currentMode !== 'spectate') isAITurn = false;
}

async function askCoachForHint() {
    if(aiThinking || game.game_over() || isResigned) return;
    
    if (currentReviewIndex !== -1) {
        exitReviewMode();
    }
    
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
        
        const btnResign = document.getElementById('btn-resign');
        const btnReview = document.getElementById('btn-review');
        if (btnResign) btnResign.classList.add('hidden');
        if (btnReview) btnReview.classList.remove('hidden');
        
        setTimeout(() => {
            if(currentMode === 'anonymous') {
                alert(`${status}\n\nYou were playing against: Gemini 2.5 Flash!`);
            } else {
                alert(status);
            }
        }, 400); // Wait for animation to finish
    }
}

// Local Storage API Key helpers
function loadUserKey() {
    const key = localStorage.getItem('user_gemini_api_key') || '';
    const input = document.getElementById('user-api-key');
    const badge = document.getElementById('key-status-badge');
    
    if (input) {
        input.value = key;
    }
    
    if (badge) {
        if (key) {
            badge.innerText = "Active";
            badge.className = "text-[9px] px-1.5 py-0.25 rounded-full bg-emerald-100 text-emerald-800 font-semibold select-none animate-fade-in";
        } else {
            badge.innerText = "Not Set";
            badge.className = "text-[9px] px-1.5 py-0.25 rounded-full bg-stone-200 text-stone-600 font-semibold select-none animate-fade-in";
        }
    }
}

function saveUserKey(val) {
    const trimmed = val.trim();
    if (trimmed) {
        localStorage.setItem('user_gemini_api_key', trimmed);
    } else {
        localStorage.removeItem('user_gemini_api_key');
    }
    loadUserKey();
}

function toggleKeyVisibility() {
    const input = document.getElementById('user-api-key');
    const eyeIcon = document.getElementById('eye-icon');
    if (!input || !eyeIcon) return;
    
    if (input.type === 'password') {
        input.type = 'text';
        eyeIcon.innerHTML = `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>`;
    } else {
        input.type = 'password';
        eyeIcon.innerHTML = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
    }
}

window.onload = () => {
    showLanding();
    loadUserKey();
};

document.addEventListener('keydown', (e) => {
    // Check if view-arena is visible
    const viewArena = document.getElementById('view-arena');
    if (!viewArena || viewArena.classList.contains('hidden')) return;
    
    // Check if typing in input/textarea/select
    if (document.activeElement && (
        document.activeElement.tagName === 'INPUT' || 
        document.activeElement.tagName === 'TEXTAREA' || 
        document.activeElement.tagName === 'SELECT'
    )) {
        return;
    }
    
    if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateHistory(-1);
    } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigateHistory(1);
    }
});

// --- Game Review & Analysis Features ---

function resignGame() {
    if (confirm("Are you sure you want to resign?")) {
        isResigned = true;
        if (isAutoplayRunning) {
            toggleAutoplay();
        }
        
        const btnResign = document.getElementById('btn-resign');
        const btnReview = document.getElementById('btn-review');
        if (btnResign) btnResign.classList.add('hidden');
        if (btnReview) btnReview.classList.remove('hidden');
        
        alert("You resigned. Game Over.");
        updateReviewUI();
    }
}

function enterReviewPanelMode() {
    const chatPanel = document.getElementById('learn-chat-panel');
    const reviewPanel = document.getElementById('game-review-panel');
    if (chatPanel) {
        chatPanel.classList.remove('flex');
        chatPanel.classList.add('hidden');
    }
    if (reviewPanel) {
        reviewPanel.classList.remove('hidden');
        reviewPanel.classList.add('flex');
        
        // Scroll into view on mobile viewports
        if (window.innerWidth < 768) {
            setTimeout(() => {
                reviewPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        }
    }
    const tableWrapper = document.getElementById('analysis-table-wrapper');
    const toggleIcon = document.getElementById('analysis-table-toggle-icon');
    if (tableWrapper) tableWrapper.classList.add('hidden');
    if (toggleIcon) toggleIcon.textContent = '＋';
    
    currentReviewIndex = 0;
    updateReviewUI();
}

function toggleAnalysisTable() {
    const wrapper = document.getElementById('analysis-table-wrapper');
    const toggleIcon = document.getElementById('analysis-table-toggle-icon');
    if (!wrapper || !toggleIcon) return;
    
    if (wrapper.classList.contains('hidden')) {
        wrapper.classList.remove('hidden');
        toggleIcon.textContent = '－';
    } else {
        wrapper.classList.add('hidden');
        toggleIcon.textContent = '＋';
    }
}

function jumpToReviewMove(moveIndex) {
    currentReviewIndex = moveIndex;
    updateReviewUI();
}

function updateEvalBar(score, isMate, turn) {
    const evalBarWhite = document.getElementById('eval-bar-white');
    const evalScoreText = document.getElementById('eval-score-text');
    if (!evalBarWhite || !evalScoreText) return;

    let percent;
    let text;

    if (isMate) {
        if (score > 0) {
            percent = 95;
            text = `M${score}`;
        } else if (score < 0) {
            percent = 5;
            text = `M${Math.abs(score)}`;
        } else {
            percent = turn === 'w' ? 5 : 95;
            text = 'M';
        }
    } else {
        const pawns = (score / 100).toFixed(1);
        text = score > 0 ? `+${pawns}` : pawns;
        
        // Map to percentage: 50 + (score / 10), clamped between 5% and 95%
        let calculated = 50 + (score / 10);
        percent = Math.max(5, Math.min(95, calculated));
    }

    evalBarWhite.style.height = `${percent}%`;
    evalScoreText.innerText = text;
    
    // Position text: if White bar is high, put text at the bottom.
    // If White bar is low, put text at the top.
    if (percent > 50) {
        evalScoreText.style.top = '';
        evalScoreText.style.bottom = '6px';
    } else {
        evalScoreText.style.bottom = '';
        evalScoreText.style.top = '6px';
    }
}

function getStockfishEval(fen, depth = 8) {
    return new Promise(async (resolve, reject) => {
        // Handle terminal states (checkmate, draw, stalemate) immediately
        // since Stockfish doesn't return a 'bestmove' line when no legal moves exist.
        try {
            const temp = new Chess(fen);
            if (temp.game_over()) {
                const turn = temp.turn();
                let isMate = false;
                let score = 0;
                if (temp.in_checkmate()) {
                    isMate = true;
                    score = turn === 'w' ? -1 : 1; // Mate in 0 relative to side to move
                }
                resolve({
                    score: score,
                    isMate: isMate,
                    bestMove: null,
                    turn: turn
                });
                return;
            }
        } catch (err) {
            console.warn("FEN parsing in getStockfishEval failed:", err);
        }

        activeEvalReject = reject;
        
        if (!analysisWorker) {
            try {
                analysisWorker = new Worker('/static/js/stockfish.js?v=1.0.9');
            } catch (e) {
                console.warn("Local worker for eval failed, trying CDN...", e);
                try {
                    const cdnUrl = 'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js';
                    const response = await fetch(cdnUrl);
                    const scriptText = await response.text();
                    const blob = new Blob([scriptText], { type: 'application/javascript' });
                    const blobUrl = URL.createObjectURL(blob);
                    analysisWorker = new Worker(blobUrl);
                } catch (cdnErr) {
                    activeEvalReject = null;
                    reject(new Error("Failed to initialize eval worker: " + cdnErr.message));
                    return;
                }
            }
        }

        let latestScore = { score: 0, isMate: false };
        const turn = fen.split(' ')[1]; // 'w' or 'b'

        const onMessage = (e) => {
            const line = e.data;
            
            if (line.startsWith('info') && line.includes(' score ')) {
                const parts = line.split(' ');
                const scoreIndex = parts.indexOf('score');
                if (scoreIndex !== -1 && scoreIndex + 2 < parts.length) {
                    const type = parts[scoreIndex + 1]; // 'cp' or 'mate'
                    const val = parseInt(parts[scoreIndex + 2]);
                    if (type === 'cp') {
                        const score = turn === 'w' ? val : -val;
                        latestScore = { score: score, isMate: false };
                    } else if (type === 'mate') {
                        const score = turn === 'w' ? val : -val;
                        latestScore = { score: score, isMate: true };
                    }
                }
            }

            if (line.startsWith('bestmove')) {
                const parts = line.split(' ');
                const bestMove = parts[1];
                analysisWorker.removeEventListener('message', onMessage);
                activeEvalReject = null;
                resolve({
                    score: latestScore.score,
                    isMate: latestScore.isMate,
                    bestMove: bestMove && bestMove !== '(none)' ? bestMove : null,
                    turn: turn
                });
            }
        };

        analysisWorker.addEventListener('message', onMessage);
        analysisWorker.postMessage('uci');
        analysisWorker.postMessage('isready');
        analysisWorker.postMessage(`position fen ${fen}`);
        analysisWorker.postMessage(`go depth ${depth}`);
    });
}

function getGamePositions() {
    const positions = [];
    const tempGame = new Chess(initialFen);
    
    positions.push({
        fen: tempGame.fen(),
        move: null,
        turn: tempGame.turn()
    });

    const history = game.history({ verbose: true });
    for (let i = 0; i < history.length; i++) {
        const m = history[i];
        tempGame.move(m);
        positions.push({
            fen: tempGame.fen(),
            move: {
                from: m.from,
                to: m.to,
                promotion: m.promotion,
                san: m.san,
                uci: m.from + m.to + (m.promotion || '')
            },
            turn: tempGame.turn()
        });
    }
    return positions;
}

function getNumericalScore(evalObj) {
    if (evalObj.isMate) {
        const sign = evalObj.score > 0 ? 1 : -1;
        const n = Math.abs(evalObj.score);
        return sign * (100000 - n * 1000);
    }
    return evalObj.score;
}

function getMoveAccuracyValue(category) {
    switch (category) {
        case 'best': return 100;
        case 'book': return 100;
        case 'excellent': return 95;
        case 'good': return 80;
        case 'inaccuracy': return 50;
        case 'mistake': return 20;
        case 'blunder': return 0;
        default: return 100;
    }
}

async function startGameAnalysis() {
    if (isAnalyzing) return;
    
    const positions = getGamePositions();
    if (positions.length <= 1) {
        alert("No moves have been played yet to analyze.");
        return;
    }

    isAnalyzing = true;
    
    analysisData = {
        evaluations: [],
        whiteAccuracy: 0,
        blackAccuracy: 0,
        whiteCounts: { best: 0, book: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
        blackCounts: { best: 0, book: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
        moves: []
    };

    const progressContainer = document.getElementById('analysis-progress-container');
    const progressText = document.getElementById('analysis-progress-text');
    const progressBar = document.getElementById('analysis-progress-bar');
    const welcomeView = document.getElementById('analysis-welcome');
    const resultsView = document.getElementById('analysis-results');

    if (progressContainer) progressContainer.classList.remove('hidden');
    if (welcomeView) welcomeView.classList.add('hidden');
    if (resultsView) resultsView.classList.add('hidden');

    try {
        for (let i = 0; i < positions.length; i++) {
            if (!isAnalyzing) return;
            if (progressText) progressText.innerText = `Analyzing position ${i + 1} of ${positions.length}...`;
            if (progressBar) progressBar.style.width = `${((i + 1) / positions.length) * 100}%`;
            
            const pos = positions[i];
            const evalRes = await getStockfishEval(pos.fen, 8);
            analysisData.evaluations.push(evalRes);
        }

        if (!isAnalyzing) return;

        for (let i = 1; i < positions.length; i++) {
            const playedMove = positions[i].move;
            const evalBefore = analysisData.evaluations[i - 1];
            const evalAfter = analysisData.evaluations[i];
            const playerColor = positions[i - 1].turn;

            const numBefore = getNumericalScore(evalBefore);
            const numAfter = getNumericalScore(evalAfter);

            let loss = 0;
            if (playerColor === 'w') {
                if (evalBefore.isMate && evalBefore.score > 0 && evalAfter.isMate && evalAfter.score > 0) {
                    loss = 0;
                } else {
                    loss = numAfter - numBefore;
                }
            } else {
                if (evalBefore.isMate && evalBefore.score < 0 && evalAfter.isMate && evalAfter.score < 0) {
                    loss = 0;
                } else {
                    loss = numBefore - numAfter;
                }
            }

            const lossPawn = loss / 100;
            let category = 'excellent';

            if (evalBefore.bestMove && playedMove.uci === evalBefore.bestMove) {
                category = 'best';
            } else if (i <= 8 && lossPawn >= -0.1) {
                category = 'book';
            } else if (lossPawn >= -0.2) {
                category = 'excellent';
            } else if (lossPawn >= -0.5) {
                category = 'good';
            } else if (lossPawn >= -1.0) {
                category = 'inaccuracy';
            } else if (lossPawn >= -2.0) {
                category = 'mistake';
            } else {
                category = 'blunder';
            }

            playedMove.category = category;
            playedMove.accuracy = getMoveAccuracyValue(category);
            playedMove.turn = playerColor;
            playedMove.moveIndex = i;

            analysisData.moves.push(playedMove);

            if (playerColor === 'w') {
                analysisData.whiteCounts[category]++;
            } else {
                analysisData.blackCounts[category]++;
            }
        }

        let whiteSum = 0, whiteCount = 0;
        let blackSum = 0, blackCount = 0;
        analysisData.moves.forEach(m => {
            if (m.turn === 'w') {
                whiteSum += m.accuracy;
                whiteCount++;
            } else {
                blackSum += m.accuracy;
                blackCount++;
            }
        });

        analysisData.whiteAccuracy = whiteCount > 0 ? Math.round(whiteSum / whiteCount) : 100;
        analysisData.blackAccuracy = blackCount > 0 ? Math.round(blackSum / blackCount) : 100;

        if (progressContainer) progressContainer.classList.add('hidden');
        if (resultsView) resultsView.classList.remove('hidden');

        document.getElementById('white-accuracy').innerText = `${analysisData.whiteAccuracy}%`;
        document.getElementById('black-accuracy').innerText = `${analysisData.blackAccuracy}%`;

        const tableBody = document.getElementById('analysis-table-body');
        if (tableBody) {
            const categories = [
                { id: 'best', label: 'Best', badgeClass: 'badge-best' },
                { id: 'excellent', label: 'Excellent', badgeClass: 'badge-excellent' },
                { id: 'good', label: 'Good', badgeClass: 'badge-good' },
                { id: 'book', label: 'Book', badgeClass: 'badge-book' },
                { id: 'inaccuracy', label: 'Inaccuracy', badgeClass: 'badge-inaccuracy' },
                { id: 'mistake', label: 'Mistake', badgeClass: 'badge-mistake' },
                { id: 'blunder', label: 'Blunder', badgeClass: 'badge-blunder' }
            ];
            
            tableBody.innerHTML = categories.map(cat => `
                <tr>
                    <td class="px-3 py-1.5 flex items-center gap-1.5">
                        <span class="badge ${cat.badgeClass}">${cat.label}</span>
                    </td>
                    <td class="px-3 py-1.5 text-center font-bold">${analysisData.whiteCounts[cat.id]}</td>
                    <td class="px-3 py-1.5 text-center font-bold">${analysisData.blackCounts[cat.id]}</td>
                </tr>
            `).join('');
        }

        const moveListContainer = document.getElementById('analysis-move-list');
        if (moveListContainer) {
            let html = '';
            const moves = analysisData.moves;
            
            for (let i = 0; i < moves.length; i += 2) {
                const moveNum = Math.floor(i / 2) + 1;
                const whiteMove = moves[i];
                const blackMove = moves[i + 1];
                
                const wBadgeClass = `badge-${whiteMove.category}`;
                const wClick = `jumpToReviewMove(${whiteMove.moveIndex})`;
                
                let blackMoveHTML = '';
                if (blackMove) {
                    const bBadgeClass = `badge-${blackMove.category}`;
                    const bClick = `jumpToReviewMove(${blackMove.moveIndex})`;
                    blackMoveHTML = `
                        <div onclick="${bClick}" class="flex-1 flex items-center justify-between px-2 py-1 hover:bg-stone-100 rounded cursor-pointer transition-colors text-xs">
                            <span class="font-semibold text-stone-700">${blackMove.san}</span>
                            <span class="badge ${bBadgeClass}">${blackMove.category}</span>
                        </div>
                    `;
                } else {
                    blackMoveHTML = `<div class="flex-1"></div>`;
                }

                html += `
                    <div class="flex items-center gap-2 py-1">
                        <span class="w-8 text-stone-400 font-bold text-center text-xs">${moveNum}.</span>
                        <div onclick="${wClick}" class="flex-1 flex items-center justify-between px-2 py-1 hover:bg-stone-100 rounded cursor-pointer transition-colors text-xs">
                            <span class="font-semibold text-stone-700">${whiteMove.san}</span>
                            <span class="badge ${wBadgeClass}">${whiteMove.category}</span>
                        </div>
                        ${blackMoveHTML}
                    </div>
                `;
            }
            moveListContainer.innerHTML = html;
        }

        isAnalyzing = false;
        
        currentReviewIndex = 0;
        updateReviewUI();

    } catch (e) {
        if (e.message !== "Analysis cancelled") {
            console.error("Analysis failed:", e);
            alert("Stockfish analysis failed: " + e.message);
        }
        isAnalyzing = false;
        if (progressContainer) progressContainer.classList.add('hidden');
        if (welcomeView) welcomeView.classList.remove('hidden');
    }
}
