// ML exam trainer, front end.
//
// Two kinds of run:
//  - the main run: every question once, in a shuffled order, in rounds of
//    ten; this is what the score, the final results and the saved server
//    progress describe;
//  - practice decks: the questions of one topic, or the ones answered wrong
//    so far; answers here never change the main score, and a question stays
//    in the missed deck until it is answered right.
// A round summary appears after every ten answers and when a deck ends.

const ROUND_SIZE = 10;

let questions = [];
let qById = new Map();
let currentQuestionIndex = 0;
let score = 0;
let answered = 0;
let topicStats = {};
let userEmail = null;
let sourceSlug = 'ml-app';
let answerHistory = {}; // questionId -> { selectedOption, correct, correctAnswer, topic, legacy, explanation, at }
let legacyAnsweredIds = new Set(); // questions answered before per-question history existed
let legacyThreshold = 0; // number of leading questions considered answered before history existed
let lastNav = null; // 'next' | 'back' | null

// Practice state. `practice` is null in the main run; otherwise
// { mode: 'topic' | 'missed', topic, deck: [ids], index, answers: { position: entry } }.
// `practiceHistory` keeps the latest practice result per question so the
// missed deck and the topic picker can see what the student still gets wrong.
let practice = null;
let practiceHistory = {}; // questionId -> { correct, at }
let screenBeforePicker = 'quiz';

// PostHog event helper (safe if PostHog failed to load)
function track(event, props) {
    try {
        if (window.posthog) window.posthog.capture(event, props);
    } catch (e) {
        // analytics must never break the app
    }
}

function identifyUser(email) {
    try {
        if (window.posthog && email) window.posthog.identify(email);
    } catch (e) {
        // analytics must never break the app
    }
}

// Utility: ensure Next button is visible on small screens
function scrollNextIntoView() {
    try {
        if (nextBtn) {
            nextBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Nudge a bit more to account for floating chip height
            setTimeout(() => {
                window.scrollBy({ top: 80, left: 0, behavior: 'smooth' });
            }, 120);
        }
    } catch (e) {
        // noop
    }
}

// Utility: scroll the current question card to the top of the viewport
function scrollQuestionToTop() {
    try {
        const card = document.querySelector('.quiz-card');
        if (!card) return;
        // Compute absolute Y and do robust scroll with retry to handle mobile address bar
        const y = (window.pageYOffset || document.documentElement.scrollTop || 0) + card.getBoundingClientRect().top - 8;
        window.scrollTo({ top: y, left: 0, behavior: 'smooth' });
        // Retry after rendering to ensure final position
        requestAnimationFrame(() => {
            setTimeout(() => {
                window.scrollTo({ top: y, left: 0, behavior: 'auto' });
            }, 120);
        });
    } catch (e) {
        // noop
    }
}

function scrollPageToTop() {
    try {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    } catch (e) {
        // noop
    }
}

// Capture source from URL parameter on page load
(function initializeSource() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlSource = urlParams.get('source');

    if (urlSource) {
        sourceSlug = urlSource;
        try { localStorage.setItem('source_slug', urlSource); } catch (e) { /* noop */ }
    } else {
        let storedSource = null;
        try { storedSource = localStorage.getItem('source_slug'); } catch (e) { /* noop */ }
        if (storedSource) {
            sourceSlug = storedSource;
        }
    }
})();

// DOM Elements
const questionText = document.getElementById('questionText');
const topicBadge = document.getElementById('topicBadge');
const optionsContainer = document.getElementById('optionsContainer');
const feedback = document.getElementById('feedback');
const feedbackText = document.getElementById('feedbackText');
const explanationText = document.getElementById('explanationText');
const searchSuggestion = document.getElementById('searchSuggestion');
const searchLink = document.getElementById('searchLink');
const nextBtn = document.getElementById('nextBtn');
const backBtn = document.getElementById('backBtn');
const searchLinkInline = document.getElementById('searchLinkInline');
const questionCounter = document.getElementById('questionCounter');
const scoreCounter = document.getElementById('scoreCounter');
const progressBar = document.getElementById('progressBar');
const modeLabel = document.getElementById('modeLabel');
const modeChangeBtn = document.getElementById('modeChangeBtn');
const quizContainer = document.getElementById('quizContainer');
const resultsContainer = document.getElementById('resultsContainer');
const summaryContainer = document.getElementById('summaryContainer');
const pickerContainer = document.getElementById('pickerContainer');
const welcomeModal = document.getElementById('welcomeModal');
const signInModal = document.getElementById('signInModal');
const signInBtn = document.getElementById('signInBtn');
const signInForm = document.getElementById('signInForm');
const signInEmailInput = document.getElementById('signInEmailInput');
const signInSubmitBtn = document.getElementById('signInSubmitBtn');
const signInStatus = document.getElementById('signInStatus');
const cancelSignInBtn = document.getElementById('cancelSignInBtn');
const signInSaveBtn = document.getElementById('signInSaveBtn');
const donateBtn = document.getElementById('donateBtn');
const summarySignup = document.getElementById('summarySignup');
const summaryEmail = document.getElementById('summaryEmail');
const summarySignupStatus = document.getElementById('summarySignupStatus');
const shareNote = document.getElementById('shareNote');

// Shuffle array using Fisher-Yates algorithm
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// ---------------------------------------------------------------- persistence

function progressSnapshot() {
    return {
        currentQuestionIndex,
        score,
        answered,
        topicStats,
        questionOrder: questions.map(q => q.id),
        answerHistory
    };
}

// localStorage can throw (private browsing, full storage); the quiz must go on without it.
function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* no persistence this session */ }
}

function storageRemove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* noop */ }
}

function saveToLocalStorage() {
    storageSet('quizProgress', JSON.stringify(progressSnapshot()));
}

function loadFromLocalStorage() {
    try {
        const saved = localStorage.getItem('quizProgress');
        return saved ? JSON.parse(saved) : null;
    } catch (e) {
        return null;
    }
}

function clearLocalStorage() {
    storageRemove('quizProgress');
}

function savePracticeState() {
    storageSet('practiceState', JSON.stringify({ practice, practiceHistory }));
}

function loadPracticeState() {
    try {
        const saved = localStorage.getItem('practiceState');
        if (!saved) return;
        const parsed = JSON.parse(saved);
        practiceHistory = parsed.practiceHistory || {};
        const p = parsed.practice;
        if (p && Array.isArray(p.deck) && p.deck.every(id => qById.has(id)) && p.index < p.deck.length) {
            practice = { mode: p.mode, topic: p.topic || null, deck: p.deck, index: p.index, answers: p.answers || {} };
        }
    } catch (e) {
        practiceHistory = {};
    }
}

function clearPracticeState() {
    practice = null;
    practiceHistory = {};
    storageRemove('practiceState');
}

function getStoredEmail() {
    try { return localStorage.getItem('userEmail'); } catch (e) { return null; }
}

function setStoredEmail(email) {
    storageSet('userEmail', email);
}

// Progress management
async function saveProgress(email) {
    try {
        track('progress_save_attempt', { source: sourceSlug });
        const response = await fetch('/api/progress/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email,
                source_slug: sourceSlug,
                progress: progressSnapshot()
            })
        });

        if (!response.ok) {
            throw new Error('Failed to save progress');
        }

        return true;
    } catch (error) {
        console.error('Error saving progress:', error);
        return false;
    }
}

// Returns { progress } or { reason }: not_found, rate_limited, server_error, network_error
async function fetchProgress(email) {
    try {
        const response = await fetch(`/api/progress/${encodeURIComponent(email)}`);
        if (response.status === 429) return { reason: 'rate_limited' };
        if (!response.ok) return { reason: 'server_error' };

        const data = await response.json();
        return data.exists ? { progress: data.progress } : { reason: 'not_found' };
    } catch (error) {
        console.error('Error loading progress:', error);
        return { reason: 'network_error' };
    }
}

async function loadProgress(email) {
    return (await fetchProgress(email)).progress || null;
}

async function resetProgress(email) {
    try {
        const response = await fetch('/api/progress/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });

        if (!response.ok) {
            throw new Error('Failed to reset progress');
        }

        return true;
    } catch (error) {
        console.error('Error resetting progress:', error);
        return false;
    }
}

// ---------------------------------------------------------------- modals

function showSignInModal() {
    signInModal.classList.remove('hidden');
    track('sign_in_modal_shown');
}

function hideSignInModal() {
    signInModal.classList.add('hidden');
    signInEmailInput.value = '';
    setSignInStatus('');
    signInSaveBtn.classList.add('hidden');
}

const SIGN_IN_MESSAGES = {
    not_found: 'Nothing saved under this email yet. Save your current progress under it?',
    finished: 'This run is already finished. Cancel to start a new quiz.',
    rate_limited: 'Too many attempts. Wait a minute and try again.',
    server_error: 'Something went wrong. Try again.',
    network_error: 'Something went wrong. Check your connection and try again.'
};

function setSignInStatus(message, ok = false) {
    signInStatus.textContent = message;
    signInStatus.classList.toggle('hidden', !message);
    signInStatus.classList.toggle('ok', ok);
}

// Adopt an email for the current run: save now, and keep saving after each answer.
async function adoptEmail(email) {
    const success = await saveProgress(email);
    if (!success) return false;
    userEmail = email;
    setStoredEmail(email);
    identifyUser(email);
    updateSignInButton();
    track('progress_save_success', { source: sourceSlug, where: 'sign_in' });
    return true;
}

function showWelcomeModal(email, progress) {
    document.getElementById('welcomeEmail').textContent = email;
    document.getElementById('progressInfo').textContent =
        `Resume from question ${progress.currentQuestionIndex + 1} (Score: ${progress.score}/${progress.answered})`;
    welcomeModal.classList.remove('hidden');
    track('welcome_modal_shown');
}

function hideWelcomeModal() {
    welcomeModal.classList.add('hidden');
}

// Update sign in button visibility
function updateSignInButton() {
    if (userEmail) {
        signInBtn.classList.add('hidden');
    } else {
        signInBtn.classList.remove('hidden');
    }
}

// Handle donation button click
async function handleDonationClick() {
    try {
        // Log donation click to backend
        const email = getStoredEmail();
        await fetch('/api/donate/click', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });

        track('donate_click');

        // Open MobilePay link
        window.open('/donate', '_blank', 'noopener');
    } catch (error) {
        console.error('Error logging donation click:', error);
        // Still open the link even if logging fails
        window.open('/donate', '_blank', 'noopener');
    }
}

// ---------------------------------------------------------------- screens

function showScreen(name) {
    quizContainer.classList.toggle('hidden', name !== 'quiz');
    summaryContainer.classList.toggle('hidden', name !== 'summary');
    pickerContainer.classList.toggle('hidden', name !== 'picker');
    resultsContainer.classList.toggle('hidden', name !== 'results');
}

function activeScreen() {
    if (!summaryContainer.classList.contains('hidden')) return 'summary';
    if (!pickerContainer.classList.contains('hidden')) return 'picker';
    if (!resultsContainer.classList.contains('hidden')) return 'results';
    return 'quiz';
}

// ---------------------------------------------------------------- deck helpers

function currentDeckLength() {
    return practice ? practice.deck.length : questions.length;
}

function currentPosition() {
    return practice ? practice.index : currentQuestionIndex;
}

function questionAt(position) {
    return practice ? qById.get(practice.deck[position]) : questions[position];
}

function currentQuestion() {
    return questionAt(currentPosition());
}

function entryAt(position) {
    if (practice) return practice.answers[position] || null;
    const q = questions[position];
    return q ? answerHistory[q.id] || null : null;
}

function isRoundEnd(position) {
    return (position + 1) % ROUND_SIZE === 0 || position === currentDeckLength() - 1;
}

function roundNumber(position) {
    return Math.floor(position / ROUND_SIZE) + 1;
}

// Latest result for a question across the main run and practice.
// Old main-run entries carry no timestamp, so a practice attempt wins over them.
function latestResult(id) {
    const main = answerHistory[id];
    const prac = practiceHistory[id];
    if (prac && (!main || prac.at > (main.at || 0))) return prac.correct;
    if (main) return !!main.correct;
    return null;
}

function missedQuestionIds() {
    return questions.map(q => q.id).filter(id => latestResult(id) === false);
}

function topicSummary() {
    const byTopic = new Map();
    questions.forEach(q => {
        if (!byTopic.has(q.topic)) byTopic.set(q.topic, { topic: q.topic, total: 0, answered: 0, correct: 0 });
        const t = byTopic.get(q.topic);
        t.total++;
        const r = latestResult(q.id);
        if (r !== null) {
            t.answered++;
            if (r) t.correct++;
        }
    });
    return [...byTopic.values()];
}

function deckLabel() {
    if (!practice) return 'All questions';
    if (practice.mode === 'missed') return 'Missed questions';
    return `Practice: ${practice.topic}`;
}

function updateHeader() {
    const position = currentPosition();
    const length = currentDeckLength();
    modeLabel.textContent = deckLabel();
    modeChangeBtn.textContent = practice ? 'Change' : 'Practice a topic';

    if (practice) {
        const done = Object.keys(practice.answers).length;
        const right = Object.values(practice.answers).filter(a => a.correct).length;
        questionCounter.textContent = `Question ${Math.min(position + 1, length)} of ${length}`;
        scoreCounter.textContent = `This deck: ${right}/${done}`;
        progressBar.style.width = `${(position / Math.max(length, 1)) * 100}%`;
    } else {
        questionCounter.textContent = `Round ${roundNumber(position)} · ${(position % ROUND_SIZE) + 1} of ${ROUND_SIZE}`;
        scoreCounter.textContent = `Score: ${score}/${answered}`;
        progressBar.style.width = `${(position / Math.max(length, 1)) * 100}%`;
    }
}

// ---------------------------------------------------------------- loading

// Load questions from API
async function loadQuestions() {
    try {
        const response = await fetch('/api/questions');
        const loadedQuestions = await response.json();
        questions = shuffleArray(loadedQuestions);
        qById = new Map(questions.map(q => [q.id, q]));
        console.log(`Loaded ${questions.length} questions (randomized)`);
        loadPracticeState();

        // Check if user has saved progress
        const storedEmail = getStoredEmail();
        if (storedEmail) {
            identifyUser(storedEmail);
            const progress = await loadProgress(storedEmail);
            if (progress && progress.currentQuestionIndex < questions.length) {
                userEmail = storedEmail;
                updateSignInButton();
                showWelcomeModal(storedEmail, progress);
                return;
            }
            updateSignInButton();
        } else {
            updateSignInButton();
            // Progress saved in this browser continues without an account.
            const saved = loadFromLocalStorage();
            if (saved && Array.isArray(saved.questionOrder) && saved.questionOrder.length) {
                restoreProgress(saved);
                return;
            }
        }
        displayQuestion();
    } catch (error) {
        console.error('Error loading questions:', error);
        questionText.textContent = 'Error loading questions. Please refresh the page.';
    }
}

// Restore progress from saved data
function restoreProgress(progress) {
    // Restore question order. Questions added to the bank after the save
    // were never part of the order, so they go to the end in random order.
    const questionMap = new Map(questions.map(q => [q.id, q]));
    const seen = new Set();
    const ordered = [];
    (progress.questionOrder || []).forEach(id => {
        const q = questionMap.get(id);
        if (q && !seen.has(id)) {
            ordered.push(q);
            seen.add(id);
        }
    });
    const added = shuffleArray(questions.filter(q => !seen.has(q.id)));
    questions = ordered.concat(added);
    qById = new Map(questions.map(q => [q.id, q]));

    // Restore state
    currentQuestionIndex = Math.min(progress.currentQuestionIndex || 0, questions.length);
    score = progress.score || 0;
    answered = progress.answered || 0;
    topicStats = progress.topicStats || {};
    answerHistory = progress.answerHistory || {};

    // Derive legacy set and threshold for first `answered` questions without answerHistory
    legacyAnsweredIds = new Set();
    const answeredCount = typeof progress.answered === 'number' ? progress.answered : 0;
    legacyThreshold = Math.max(0, Math.min(questions.length, answeredCount));
    for (let i = 0; i < legacyThreshold; i++) {
        const q = questions[i];
        if (q && !answerHistory[q.id]) legacyAnsweredIds.add(q.id);
    }

    hideWelcomeModal();
    displayQuestion();
}

// ---------------------------------------------------------------- question screen

function renderFeedback(entry) {
    feedback.classList.remove('hidden');
    feedback.classList.toggle('correct', !!entry.correct);
    feedback.classList.toggle('incorrect', !entry.correct);
    feedbackText.textContent = entry.correct
        ? '✓ Correct.'
        : `✗ Not quite. The answer is ${entry.correctAnswer}.`;
    explanationText.textContent = entry.explanation || '';
    explanationText.classList.toggle('hidden', !entry.explanation);
    searchSuggestion.classList.toggle('hidden', !!entry.correct);
}

function setNextLabel(position) {
    nextBtn.textContent = isRoundEnd(position) ? 'Round summary' : 'Next question';
}

// Display current question
function displayQuestion() {
    const position = currentPosition();
    if (position >= currentDeckLength()) {
        if (practice) {
            leavePractice();
        } else {
            showResults();
        }
        return;
    }

    showScreen('quiz');
    const question = currentQuestion();

    // Reset state
    feedback.classList.add('hidden');
    nextBtn.classList.add('hidden');
    searchSuggestion.classList.add('hidden');
    explanationText.classList.add('hidden');
    if (backBtn) backBtn.classList.toggle('hidden', position === 0);

    // Update question
    questionText.textContent = question.question;
    topicBadge.textContent = question.topic;
    const searchQuery = `https://www.google.com/search?q=${encodeURIComponent(`${question.topic} ${question.question}`)}`;
    if (searchLinkInline) searchLinkInline.href = searchQuery;
    searchLink.href = searchQuery;

    updateHeader();

    // Display options
    const optionButtons = optionsContainer.querySelectorAll('.option-btn');
    optionButtons.forEach((btn) => {
        const optionKey = btn.dataset.option;
        const optionTextEl = btn.querySelector('.option-text');

        optionTextEl.textContent = question.options[optionKey];
        btn.disabled = false;
        btn.classList.remove('correct', 'incorrect');

        // Remove old event listeners by cloning
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.addEventListener('click', () => handleAnswer(optionKey));
    });

    // If already answered, show review state
    const existing = entryAt(position);
    if (existing) {
        const optionButtonsNow = optionsContainer.querySelectorAll('.option-btn');
        optionButtonsNow.forEach(btn => {
            btn.disabled = true;
            if (btn.dataset.option === existing.selectedOption) {
                btn.classList.add(existing.correct ? 'correct' : 'incorrect');
            }
            if (!existing.correct && btn.dataset.option === existing.correctAnswer) {
                btn.classList.add('correct');
            }
        });
        renderFeedback(existing);
        setNextLabel(position);
        nextBtn.classList.remove('hidden');
        if (lastNav === 'back') scrollQuestionToTop();
        lastNav = null;
        return;
    }

    // If legacy-answered (pre-history), allow skipping and show Next immediately
    const isLegacyIndex = !practice && position < legacyThreshold && !answerHistory[question.id];
    if (isLegacyIndex) {
        feedback.classList.remove('hidden');
        feedback.classList.remove('incorrect');
        feedback.classList.add('correct');
        feedbackText.textContent = 'Previously answered earlier. Score will not change here.';
        setNextLabel(position);
        nextBtn.classList.remove('hidden');
        scrollNextIntoView();
    }

    // Scroll to top only when moving forward to a new question
    if (lastNav === 'next' && !isLegacyIndex) {
        scrollQuestionToTop();
    }
    lastNav = null;
}

// Handle answer selection
async function handleAnswer(selectedOption) {
    const optionButtons = optionsContainer.querySelectorAll('.option-btn');

    // Disable all buttons
    optionButtons.forEach(btn => btn.disabled = true);

    try {
        const position = currentPosition();
        const question = currentQuestion();
        const response = await fetch('/api/check-answer', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                questionId: question.id,
                answer: selectedOption
            })
        });

        if (!response.ok) throw new Error(`check-answer ${response.status}`);
        const result = await response.json();
        const questionId = question.id;
        const entry = {
            selectedOption,
            correct: !!result.correct,
            correctAnswer: result.correctAnswer,
            topic: result.topic,
            explanation: result.explanation || '',
            at: Date.now()
        };

        if (practice) {
            practice.answers[position] = entry;
            practiceHistory[questionId] = { correct: entry.correct, at: entry.at };
            savePracticeState();
            track(entry.correct ? 'answer_correct' : 'answer_incorrect', { topic: result.topic, mode: practice.mode });
        } else {
            const isLegacy = (position < legacyThreshold) && !answerHistory[questionId];
            entry.legacy = !!isLegacy;
            if (!isLegacy) {
                answered++;
            }

            // Track topic statistics
            if (!topicStats[result.topic]) {
                topicStats[result.topic] = { correct: 0, total: 0 };
            }
            if (!isLegacy) {
                topicStats[result.topic].total++;
                if (result.correct) {
                    score++;
                    topicStats[result.topic].correct++;
                }
            }
            answerHistory[questionId] = entry;
            track(entry.correct ? 'answer_correct' : 'answer_incorrect', { topic: result.topic, mode: 'main' });
        }

        // Highlight the chosen option and, when wrong, the right one
        optionButtons.forEach(btn => {
            if (btn.dataset.option === selectedOption) {
                btn.classList.add(entry.correct ? 'correct' : 'incorrect');
            }
            if (!entry.correct && btn.dataset.option === result.correctAnswer) {
                btn.classList.add('correct');
            }
        });

        renderFeedback(entry);
        updateHeader();
        setNextLabel(position);
        nextBtn.classList.remove('hidden');
        // After layout updates, scroll Next button into view (mobile convenience)
        setTimeout(scrollNextIntoView, 50);
        nextBtn.focus({ preventScroll: true });

        if (!practice) {
            // Save progress to localStorage
            saveToLocalStorage();

            // Save to server if user has email
            if (userEmail) {
                await saveProgress(userEmail);
            }
        }
    } catch (error) {
        console.error('Error checking answer:', error);
        optionButtons.forEach(btn => btn.disabled = false);
        feedback.classList.remove('correct');
        feedback.classList.add('incorrect');
        feedbackText.textContent = 'Could not check the answer. Check your connection and pick again.';
        explanationText.classList.add('hidden');
        searchSuggestion.classList.add('hidden');
        feedback.classList.remove('hidden');
    }
}

// Move to next question, or to the round summary at a round boundary
nextBtn.addEventListener('click', () => {
    const position = currentPosition();
    if (entryAt(position) && isRoundEnd(position)) {
        showSummary(position);
        return;
    }
    advance();
});

function advance() {
    lastNav = 'next';
    if (practice) {
        practice.index++;
        savePracticeState();
    } else {
        currentQuestionIndex++;
        saveToLocalStorage();
    }
    displayQuestion();
}

// Move to previous question
if (backBtn) {
    backBtn.addEventListener('click', () => {
        const position = currentPosition();
        if (position > 0) {
            lastNav = 'back';
            if (practice) {
                practice.index--;
                savePracticeState();
            } else {
                currentQuestionIndex--;
                saveToLocalStorage();
            }
            displayQuestion();
        }
    });
}

// ---------------------------------------------------------------- round summary

function showSummary(position) {
    const start = position - (position % ROUND_SIZE);
    const ids = [];
    const entries = [];
    for (let i = start; i <= position; i++) {
        const q = questionAt(i);
        const e = entryAt(i);
        if (q && e && !e.legacy) {
            ids.push(q.id);
            entries.push(e);
        }
    }
    if (entries.length === 0) {
        advance();
        return;
    }
    const correct = entries.filter(e => e.correct).length;
    const missed = ids.filter((id, i) => !entries[i].correct);
    const deckDone = practice && position === practice.deck.length - 1;

    let title;
    if (!practice) title = position === questions.length - 1 ? 'Last round done' : `Round ${roundNumber(position)} done`;
    else if (deckDone) title = practice.mode === 'missed' ? 'Missed questions: deck done' : `${practice.topic}: deck done`;
    else title = practice.mode === 'missed' ? 'Missed questions: round done' : `${practice.topic}: round done`;
    document.getElementById('summaryTitle').textContent = title;
    document.getElementById('summaryScore').textContent = String(correct);
    document.getElementById('summaryTotal').textContent = String(entries.length);

    // Topics in this round
    const topicsEl = document.getElementById('summaryTopics');
    topicsEl.textContent = '';
    const byTopic = new Map();
    entries.forEach(e => {
        if (!byTopic.has(e.topic)) byTopic.set(e.topic, { correct: 0, total: 0 });
        const t = byTopic.get(e.topic);
        t.total++;
        if (e.correct) t.correct++;
    });
    [...byTopic.entries()].sort((a, b) => (a[1].correct / a[1].total) - (b[1].correct / b[1].total)).forEach(([topic, stats]) => {
        topicsEl.appendChild(topicItem(topic, stats.correct, stats.total));
    });

    // What was missed, with the answer and why
    const missedEl = document.getElementById('summaryMissed');
    missedEl.textContent = '';
    if (missed.length) {
        const h = document.createElement('h3');
        h.textContent = missed.length === 1 ? 'The one you missed' : `The ${missed.length} you missed`;
        missedEl.appendChild(h);
        missed.forEach(id => {
            const q = qById.get(id);
            const e = entries[ids.indexOf(id)];
            const item = document.createElement('div');
            item.className = 'missed-item';
            const qEl = document.createElement('p');
            qEl.className = 'missed-q';
            qEl.textContent = q.question;
            const aEl = document.createElement('p');
            aEl.className = 'missed-a';
            aEl.textContent = `Answer: ${q.options[e.correctAnswer] || e.correctAnswer}`;
            item.appendChild(qEl);
            item.appendChild(aEl);
            if (e.explanation) {
                const why = document.createElement('p');
                why.className = 'missed-why';
                why.textContent = e.explanation;
                item.appendChild(why);
            }
            missedEl.appendChild(item);
        });
    }

    // Actions
    const nextButton = document.getElementById('summaryNextBtn');
    if (!practice) nextButton.textContent = position === questions.length - 1 ? 'See final results' : 'Next round';
    else nextButton.textContent = deckDone ? 'Back to all questions' : `Next ${Math.min(ROUND_SIZE, practice.deck.length - position - 1)}`;

    const missedButton = document.getElementById('summaryMissedBtn');
    missedButton.classList.toggle('hidden', missed.length === 0);
    missedButton.textContent = missed.length === 1 ? 'Practise the one you missed' : `Practise the ${missed.length} you missed`;
    missedButton.onclick = () => startPractice('missed', null, missed);

    // Sign-up card: main run only, only without an account
    summarySignup.classList.toggle('hidden', !!(userEmail || practice));
    if (!userEmail && !practice) {
        summarySignupStatus.classList.add('hidden');
        track('signup_prompt_shown', { where: 'summary', round: roundNumber(position) });
    }
    shareNote.textContent = '';

    track('round_completed', {
        mode: practice ? practice.mode : 'main',
        round: roundNumber(position),
        correct,
        total: entries.length
    });
    showScreen('summary');
    scrollPageToTop();
}

function topicItem(topic, correct, total) {
    const item = document.createElement('div');
    item.className = 'topic-item';
    const nameEl = document.createElement('span');
    nameEl.textContent = topic;
    const statsEl = document.createElement('span');
    const scoreEl = document.createElement('strong');
    scoreEl.textContent = `${correct}/${total}`;
    statsEl.appendChild(scoreEl);
    statsEl.appendChild(document.createTextNode(` (${Math.round((correct / total) * 100)}%)`));
    item.appendChild(nameEl);
    item.appendChild(statsEl);
    return item;
}

document.getElementById('summaryNextBtn').addEventListener('click', () => {
    advance();
});

document.getElementById('summaryTopicBtn').addEventListener('click', () => openPicker());

summarySignup.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = summaryEmail.value.trim();
    if (!email) return;
    const button = summarySignup.querySelector('.submit-btn');
    button.disabled = true;
    const success = await adoptEmail(email);
    button.disabled = false;
    summarySignupStatus.classList.remove('hidden');
    if (success) {
        summarySignupStatus.classList.add('ok');
        summarySignupStatus.textContent = 'Saved. Sign in with this email on any device to continue.';
        summarySignup.querySelector('.summary-signup-row').classList.add('hidden');
        summarySignup.querySelector('.skip-btn').classList.add('hidden');
    } else {
        track('progress_save_failed', { source: sourceSlug, where: 'summary' });
        summarySignupStatus.classList.remove('ok');
        summarySignupStatus.textContent = 'Could not save. Check your connection and try again.';
    }
});

document.getElementById('summarySignupSkip').addEventListener('click', () => {
    summarySignup.classList.add('hidden');
    track('signup_skipped', { where: 'summary' });
});

document.getElementById('shareBtn').addEventListener('click', async () => {
    const url = `${window.location.origin}/?source=share`;
    const text = 'Practice questions for the ML exam, with explanations:';
    try {
        if (navigator.share) {
            await navigator.share({ title: 'ML Exam Trainer', text, url });
            track('share_click', { method: 'share' });
            return;
        }
        await navigator.clipboard.writeText(url);
        shareNote.textContent = 'Link copied';
        track('share_click', { method: 'copy' });
    } catch (e) {
        shareNote.textContent = url;
    }
});

// ---------------------------------------------------------------- practice decks

function startPractice(mode, topic, ids) {
    if (!ids.length) return;
    practice = { mode, topic: topic || null, deck: shuffleArray(ids), index: 0, answers: {} };
    savePracticeState();
    track('practice_started', { mode, topic: topic || null, size: ids.length });
    lastNav = 'next';
    displayQuestion();
    scrollPageToTop();
}

function leavePractice() {
    practice = null;
    savePracticeState();
    // A deck is usually started from a round summary, so the main run's
    // current question is already answered: move past it instead of showing
    // it, and its summary, a second time.
    if (currentQuestionIndex < questions.length && entryAt(currentQuestionIndex) && isRoundEnd(currentQuestionIndex)) {
        currentQuestionIndex++;
        saveToLocalStorage();
    }
    lastNav = 'next';
    displayQuestion();
    scrollPageToTop();
}

function openPicker() {
    screenBeforePicker = activeScreen();
    if (screenBeforePicker === 'picker') screenBeforePicker = 'quiz';

    const missed = missedQuestionIds();
    const missedBtn = document.getElementById('pickMissedBtn');
    document.getElementById('pickMissedCount').textContent = missed.length === 0
        ? 'Nothing missed yet'
        : `${missed.length} waiting for a right answer`;
    missedBtn.disabled = missed.length === 0;
    missedBtn.onclick = () => startPractice('missed', null, missed);

    const list = document.getElementById('pickerTopics');
    list.textContent = '';
    const topics = topicSummary().sort((a, b) => {
        const pa = a.answered ? a.correct / a.answered : 2;
        const pb = b.answered ? b.correct / b.answered : 2;
        return pa - pb || a.topic.localeCompare(b.topic);
    });
    topics.forEach(t => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'picker-topic';
        const name = document.createElement('span');
        name.textContent = `${t.topic} (${t.total})`;
        const stat = document.createElement('span');
        stat.className = 'picker-stat';
        if (t.answered) {
            const pct = Math.round((t.correct / t.answered) * 100);
            stat.textContent = `${pct}% of ${t.answered}`;
            if (pct < 70) stat.classList.add('weak');
        } else {
            stat.textContent = 'not started';
        }
        row.appendChild(name);
        row.appendChild(stat);
        row.addEventListener('click', () => startPractice('topic', t.topic, questions.filter(q => q.topic === t.topic).map(q => q.id)));
        list.appendChild(row);
    });

    const back = document.getElementById('pickerBackBtn');
    back.textContent = practice ? 'Back to all questions' : 'Back';
    showScreen('picker');
    scrollPageToTop();
    track('picker_opened', { missed: missed.length });
}

document.getElementById('pickerBackBtn').addEventListener('click', () => {
    if (practice) {
        leavePractice();
        return;
    }
    showScreen(screenBeforePicker);
});

modeChangeBtn.addEventListener('click', () => openPicker());

// ---------------------------------------------------------------- final results

function showResults() {
    showScreen('results');

    const percentage = Math.round((score / questions.length) * 100);
    track('quiz_completed', { score, total: questions.length, percentage });

    document.getElementById('finalScore').textContent = `Your Score: ${score}/${questions.length}`;
    document.getElementById('percentage').textContent = `${percentage}%`;

    // Performance message
    let message = '';
    if (percentage >= 90) {
        message = 'You know this material. Keep the missed ones warm until the exam.';
    } else if (percentage >= 80) {
        message = 'Strong. The missed questions below are where the last points are.';
    } else if (percentage >= 70) {
        message = 'A pass, with room to spare if you drill the weakest topics.';
    } else if (percentage >= 60) {
        message = 'Borderline. Practise the topics under 70% before the exam.';
    } else {
        message = 'Go through the missed questions and their explanations, then try the weakest topics again.';
    }
    document.getElementById('performanceMessage').textContent = message;

    // Topic breakdown
    const topicBreakdown = document.getElementById('topicBreakdown');
    topicBreakdown.innerHTML = '<h4>Performance by Topic:</h4>';

    // MIS-168 H8: `topic` is a STORED value that originates from request data,
    // and /api/progress/save is unauthenticated with the email as the only
    // identifier. So an attacker could write a topic key like
    // `<img src=x onerror=...>` against someone else's email, and it would
    // execute in that person's browser when they viewed their results.
    // Built with textContent instead of innerHTML: the value can no longer be
    // parsed as markup, whatever it contains.
    Object.entries(topicStats)
        .sort((a, b) => (a[1].correct / a[1].total) - (b[1].correct / b[1].total))
        .forEach(([topic, stats]) => {
            topicBreakdown.appendChild(topicItem(topic, stats.correct, stats.total));
        });

    const missed = missedQuestionIds();
    const missedBtn = document.getElementById('resultsMissedBtn');
    missedBtn.classList.toggle('hidden', missed.length === 0);
    missedBtn.textContent = `Practise the ${missed.length} you missed`;
    missedBtn.onclick = () => startPractice('missed', null, missed);
    scrollPageToTop();
}

document.getElementById('resultsTopicBtn').addEventListener('click', () => openPicker());

// Restart quiz
document.getElementById('restartBtn').addEventListener('click', async () => {
    currentQuestionIndex = 0;
    score = 0;
    answered = 0;
    topicStats = {};
    answerHistory = {};
    legacyAnsweredIds = new Set();
    legacyThreshold = 0;
    lastNav = null;
    track('quiz_restarted');
    questions = shuffleArray(questions);
    qById = new Map(questions.map(q => [q.id, q]));

    // Clear progress
    clearLocalStorage();
    clearPracticeState();
    if (userEmail) {
        await resetProgress(userEmail);
    }

    displayQuestion();
});

// ---------------------------------------------------------------- sign in

signInBtn.addEventListener('click', () => {
    showSignInModal();
});

signInForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = signInEmailInput.value.trim();

    if (email) {
        setSignInStatus('');
        signInSubmitBtn.disabled = true;
        signInSubmitBtn.textContent = 'Loading…';

        const { progress, reason } = await fetchProgress(email);

        signInSubmitBtn.disabled = false;
        signInSubmitBtn.textContent = 'Continue';

        if (progress && progress.currentQuestionIndex < questions.length) {
            userEmail = email;
            setStoredEmail(email);
            identifyUser(email);
            updateSignInButton();
            hideSignInModal();
            showWelcomeModal(email, progress);
        } else {
            const failure = progress ? 'finished' : reason;
            setSignInStatus(SIGN_IN_MESSAGES[failure]);
            // A new email is the normal case for a first-time saver, so offer
            // to start saving under it instead of leaving the student at an error.
            signInSaveBtn.classList.toggle('hidden', failure !== 'not_found');
            track('sign_in_failed', { reason: failure });
        }
    }
});

signInSaveBtn.addEventListener('click', async () => {
    const email = signInEmailInput.value.trim();
    if (!email) return;
    signInSaveBtn.disabled = true;
    signInSaveBtn.textContent = 'Saving\u2026';
    const ok = await adoptEmail(email);
    signInSaveBtn.disabled = false;
    signInSaveBtn.textContent = 'Save my progress under this email';
    if (ok) {
        setSignInStatus('Saved. Enter this email on any device to continue from here.', true);
        signInSaveBtn.classList.add('hidden');
        signInSubmitBtn.classList.add('hidden');
        setTimeout(() => { hideSignInModal(); signInSubmitBtn.classList.remove('hidden'); }, 1800);
    } else {
        setSignInStatus('Could not save. Check your connection and try again.');
    }
});

cancelSignInBtn.addEventListener('click', () => {
    hideSignInModal();
});

// Welcome modal - Continue button
document.getElementById('continueBtn').addEventListener('click', async () => {
    const storedEmail = getStoredEmail();
    if (storedEmail) {
        const progress = await loadProgress(storedEmail);
        if (progress) {
            practice = null;
            savePracticeState();
            restoreProgress(progress);
        }
    }
    track('resume_continue');
});

// Welcome modal - Start Fresh button
document.getElementById('startFreshBtn').addEventListener('click', async () => {
    const storedEmail = getStoredEmail();
    if (storedEmail) {
        await resetProgress(storedEmail);
    }
    clearLocalStorage();
    clearPracticeState();
    hideWelcomeModal();
    displayQuestion();
    track('resume_start_fresh');
});

// Donation button event listener
donateBtn.addEventListener('click', handleDonationClick);

// Initialize app
loadQuestions();

// aalto (fi, n.): wave
console.log(
    '%c\n ~~~~~~~~~~~~~~~~~~~~~~~\n  WAVE UNIVERSITY\n  aalto (fi, n.): wave\n ~~~~~~~~~~~~~~~~~~~~~~~\n',
    'color: #7af0a4; font-family: monospace;'
);
