let questions = [];
let currentQuestionIndex = 0;
let score = 0;
let answered = 0;
let topicStats = {};
let userEmail = null;
let hasShownSignup = false;
let sourceSlug = 'ml-app';
let answerHistory = {}; // questionId -> { selectedOption, correct, correctAnswer, topic, legacy }
let legacyAnsweredIds = new Set(); // questions answered before per-question history existed
let legacyThreshold = 0; // number of leading questions considered answered before history existed
let lastNav = null; // 'next' | 'back' | null

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

// Capture source from URL parameter on page load
(function initializeSource() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlSource = urlParams.get('source');

    if (urlSource) {
        sourceSlug = urlSource;
        localStorage.setItem('source_slug', urlSource);
    } else {
        const storedSource = localStorage.getItem('source_slug');
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
const searchSuggestion = document.getElementById('searchSuggestion');
const searchLink = document.getElementById('searchLink');
const nextBtn = document.getElementById('nextBtn');
const backBtn = document.getElementById('backBtn');
const searchLinkInline = document.getElementById('searchLinkInline');
const questionCounter = document.getElementById('questionCounter');
const scoreCounter = document.getElementById('scoreCounter');
const progressBar = document.getElementById('progressBar');
const quizContainer = document.getElementById('quizContainer');
const resultsContainer = document.getElementById('resultsContainer');
const signupModal = document.getElementById('signupModal');
const welcomeModal = document.getElementById('welcomeModal');
const signInModal = document.getElementById('signInModal');
const signupForm = document.getElementById('signupForm');
const emailInput = document.getElementById('emailInput');
const signInBtn = document.getElementById('signInBtn');
const signInForm = document.getElementById('signInForm');
const signInEmailInput = document.getElementById('signInEmailInput');
const signInSubmitBtn = document.getElementById('signInSubmitBtn');
const signInStatus = document.getElementById('signInStatus');
const skipSignupBtn = document.getElementById('skipSignupBtn');
const cancelSignInBtn = document.getElementById('cancelSignInBtn');
const donateBtn = document.getElementById('donateBtn');

// Shuffle array using Fisher-Yates algorithm
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// LocalStorage helpers
function saveToLocalStorage() {
    const progress = {
        currentQuestionIndex,
        score,
        answered,
        topicStats,
        questionOrder: questions.map(q => q.id),
        answerHistory
    };
    localStorage.setItem('quizProgress', JSON.stringify(progress));
}

function loadFromLocalStorage() {
    const saved = localStorage.getItem('quizProgress');
    return saved ? JSON.parse(saved) : null;
}

function clearLocalStorage() {
    localStorage.removeItem('quizProgress');
}

function getStoredEmail() {
    return localStorage.getItem('userEmail');
}

function setStoredEmail(email) {
    localStorage.setItem('userEmail', email);
}

// Progress management
async function saveProgress(email) {
    try {
        track('progress_save_attempt', { source: sourceSlug });
        const progress = {
            currentQuestionIndex,
            score,
            answered,
            topicStats,
            questionOrder: questions.map(q => q.id),
            answerHistory
        };

        const response = await fetch('/api/progress/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email,
                source_slug: sourceSlug,
                progress
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

// Modal management
function showSignupModal() {
    signupModal.classList.remove('hidden');
    track('signup_modal_shown');
}

function hideSignupModal() {
    signupModal.classList.add('hidden');
}

function showSignInModal() {
    signInModal.classList.remove('hidden');
    track('sign_in_modal_shown');
}

function hideSignInModal() {
    signInModal.classList.add('hidden');
    signInEmailInput.value = '';
    setSignInStatus('');
}

const SIGN_IN_MESSAGES = {
    not_found: 'No saved progress found for this email.',
    finished: 'This run is already finished. Cancel to start a new quiz.',
    rate_limited: 'Too many attempts. Wait a minute and try again.',
    server_error: 'Something went wrong. Try again.',
    network_error: 'Something went wrong. Check your connection and try again.'
};

function setSignInStatus(message) {
    signInStatus.textContent = message;
    signInStatus.classList.toggle('hidden', !message);
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

// Check if user should see signup modal
function checkSignupTrigger() {
    if (!userEmail && answered === 5 && !hasShownSignup) {
        hasShownSignup = true;
        showSignupModal();
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

        // Track in Plausible
        track('donate_click');

        // Open MobilePay link
        window.open('/donate', '_blank', 'noopener');
    } catch (error) {
        console.error('Error logging donation click:', error);
        // Still open the link even if logging fails
        window.open('/donate', '_blank', 'noopener');
    }
}

// Load questions from API
async function loadQuestions() {
    try {
        const response = await fetch('/api/questions');
        const loadedQuestions = await response.json();
        questions = shuffleArray(loadedQuestions);
        console.log(`Loaded ${questions.length} questions (randomized)`);

        // Check if user has saved progress
        const storedEmail = getStoredEmail();
        if (storedEmail) {
            identifyUser(storedEmail);
            const progress = await loadProgress(storedEmail);
            if (progress && progress.currentQuestionIndex < questions.length) {
                userEmail = storedEmail;
                updateSignInButton();
                showWelcomeModal(storedEmail, progress);
            } else {
                updateSignInButton();
                displayQuestion();
            }
        } else {
            updateSignInButton();
            displayQuestion();
        }
    } catch (error) {
        console.error('Error loading questions:', error);
        questionText.textContent = 'Error loading questions. Please refresh the page.';
    }
}

// Restore progress from saved data
function restoreProgress(progress) {
    // Restore question order
    const questionMap = new Map(questions.map(q => [q.id, q]));
    questions = progress.questionOrder
        .map(id => questionMap.get(id))
        .filter(q => q !== undefined);

    // Restore state
    currentQuestionIndex = progress.currentQuestionIndex;
    score = progress.score;
    answered = progress.answered;
    topicStats = progress.topicStats;
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

// Display current question
function displayQuestion() {
    if (currentQuestionIndex >= questions.length) {
        showResults();
        return;
    }

    const question = questions[currentQuestionIndex];

    // Reset state
    feedback.classList.add('hidden');
    nextBtn.classList.add('hidden');
    searchSuggestion.classList.add('hidden');
    if (backBtn) backBtn.classList.toggle('hidden', currentQuestionIndex === 0);

    // Update question
    questionText.textContent = question.question;
    topicBadge.textContent = question.topic;
    // Update inline search link for current question
    if (searchLinkInline) {
        const q = encodeURIComponent(`${question.topic} ${question.question}`);
        searchLinkInline.href = `https://www.google.com/search?q=${q}`;
    }

    // Update counters
    questionCounter.textContent = `Question ${currentQuestionIndex + 1} of ${questions.length}`;
    scoreCounter.textContent = `Score: ${score}/${answered}`;

    // Update progress bar
    const progress = ((currentQuestionIndex) / questions.length) * 100;
    progressBar.style.width = `${progress}%`;

    // Display options
    const optionButtons = optionsContainer.querySelectorAll('.option-btn');
    optionButtons.forEach((btn, index) => {
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

    // If already answered in this version, show review state
    const existing = answerHistory[question.id];
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
        feedback.classList.remove('hidden');
        feedback.classList.toggle('correct', !!existing.correct);
        feedback.classList.toggle('incorrect', !existing.correct);
        feedbackText.textContent = existing.correct
            ? '✓ Correct! Well done!'
            : `✗ Incorrect. The correct answer is ${existing.correctAnswer}.`;
        nextBtn.classList.remove('hidden');
        scrollNextIntoView();
        return;
    }

    // If legacy-answered (pre-history), allow skipping and show Next immediately
    const isLegacyIndex = currentQuestionIndex < legacyThreshold && !answerHistory[question.id];
    if (isLegacyIndex) {
        feedback.classList.remove('hidden');
        feedback.classList.remove('incorrect');
        feedback.classList.add('correct');
        feedbackText.textContent = 'Previously answered earlier. Score will not change here.';
        nextBtn.classList.remove('hidden');
        scrollNextIntoView();
    }

    // Scroll to top only when moving forward to a new question
    if (lastNav === 'next' && !existing && !isLegacyIndex) {
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
        const question = questions[currentQuestionIndex];
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

        const result = await response.json();
        const questionId = question.id;
        const isLegacy = (currentQuestionIndex < legacyThreshold) && !answerHistory[questionId];
        if (!isLegacy) {
            answered++;
        }

        // Track topic statistics
        if (!topicStats[result.topic]) {
            topicStats[result.topic] = { correct: 0, total: 0 };
        }
        if (!isLegacy) {
            topicStats[result.topic].total++;
        }

        // Show feedback
        if (result.correct) {
            if (!isLegacy) {
                score++;
                topicStats[result.topic].correct++;
            }
            feedback.classList.remove('incorrect');
            feedback.classList.add('correct');
            feedbackText.textContent = '✓ Correct! Well done!';
            track('answer_correct', { topic: result.topic });

            // Highlight correct answer
            optionButtons.forEach(btn => {
                if (btn.dataset.option === selectedOption) {
                    btn.classList.add('correct');
                }
            });
        } else {
            feedback.classList.remove('correct');
            feedback.classList.add('incorrect');
            feedbackText.textContent = `✗ Incorrect. The correct answer is ${result.correctAnswer}.`;
            track('answer_incorrect', { topic: result.topic });

            // Highlight incorrect and correct answers
            optionButtons.forEach(btn => {
                if (btn.dataset.option === selectedOption) {
                    btn.classList.add('incorrect');
                }
                if (btn.dataset.option === result.correctAnswer) {
                    btn.classList.add('correct');
                }
            });

            // Show search suggestion for wrong answers
            searchSuggestion.classList.remove('hidden');
            const searchQuery = encodeURIComponent(`${result.topic} ${result.question}`);
            searchLink.href = `https://www.google.com/search?q=${searchQuery}`;
        }

        // Reflect the new score immediately
        scoreCounter.textContent = `Score: ${score}/${answered}`;

        // Store in answer history (mark legacy), then show feedback
        answerHistory[questionId] = {
            selectedOption,
            correct: !!result.correct,
            correctAnswer: result.correctAnswer,
            topic: result.topic,
            legacy: !!isLegacy
        };

        feedback.classList.remove('hidden');
        nextBtn.classList.remove('hidden');
        // After layout updates, scroll Next button into view (mobile convenience)
        setTimeout(scrollNextIntoView, 50);

        // Save progress to localStorage
        saveToLocalStorage();

        // Save to server if user has email
        if (userEmail) {
            await saveProgress(userEmail);
        }

        // Check if we should show signup modal (after 5 questions)
        checkSignupTrigger();

    } catch (error) {
        console.error('Error checking answer:', error);
        feedbackText.textContent = 'Error checking answer. Please try again.';
        feedback.classList.remove('hidden');
    }
}

// Move to next question
nextBtn.addEventListener('click', () => {
    lastNav = 'next';
    currentQuestionIndex++;
    displayQuestion();
});

// Move to previous question
if (backBtn) {
    backBtn.addEventListener('click', () => {
        if (currentQuestionIndex > 0) {
            lastNav = 'back';
            currentQuestionIndex--;
            displayQuestion();
        }
    });
}

// Show final results
function showResults() {
    quizContainer.classList.add('hidden');
    resultsContainer.classList.remove('hidden');

    const percentage = Math.round((score / questions.length) * 100);
    track('quiz_completed', { score, total: questions.length, percentage });

    document.getElementById('finalScore').textContent = `Your Score: ${score}/${questions.length}`;
    document.getElementById('percentage').textContent = `${percentage}%`;

    // Performance message
    let message = '';
    if (percentage >= 90) {
        message = 'Outstanding! You have mastered this material!';
    } else if (percentage >= 80) {
        message = 'Excellent work! You have a strong understanding!';
    } else if (percentage >= 70) {
        message = 'Good job! Keep reviewing to improve further.';
    } else if (percentage >= 60) {
        message = 'Not bad, but there is room for improvement.';
    } else {
        message = 'Keep studying! Review the topics and try again.';
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
    Object.entries(topicStats).forEach(([topic, stats]) => {
        const topicPercentage = Math.round((stats.correct / stats.total) * 100);
        const topicItem = document.createElement('div');
        topicItem.className = 'topic-item';

        const nameEl = document.createElement('span');
        nameEl.textContent = topic;

        const statsEl = document.createElement('span');
        const scoreEl = document.createElement('strong');
        scoreEl.textContent = `${stats.correct}/${stats.total}`;
        statsEl.appendChild(scoreEl);
        statsEl.appendChild(document.createTextNode(` (${topicPercentage}%)`));

        topicItem.appendChild(nameEl);
        topicItem.appendChild(statsEl);
        topicBreakdown.appendChild(topicItem);
    });
}

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
    hasShownSignup = false;
    track('quiz_restarted');
    questions = shuffleArray(questions);
    resultsContainer.classList.add('hidden');
    quizContainer.classList.remove('hidden');

    // Clear progress
    clearLocalStorage();
    if (userEmail) {
        await resetProgress(userEmail);
    }

    displayQuestion();
});

// Signup form submission
signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();

    if (email) {
        userEmail = email;
        setStoredEmail(email);
        identifyUser(email);
        updateSignInButton();

        // Save current progress to server
        const success = await saveProgress(email);

        if (success) {
            track('progress_save_success', { source: sourceSlug });
            hideSignupModal();
            // Show a brief success message
            feedbackText.textContent = '✓ Progress saved! You can now close and return anytime.';
            feedback.classList.remove('incorrect');
            feedback.classList.add('correct');
            feedback.classList.remove('hidden');
        } else {
            track('progress_save_failed', { source: sourceSlug });
            alert('Failed to save progress. Please try again.');
        }
    }
});

// Skip signup button
skipSignupBtn.addEventListener('click', () => {
    hideSignupModal();
    // Continue with the quiz without saving
    track('signup_skipped');
});

// Sign in button in header
signInBtn.addEventListener('click', () => {
    showSignInModal();
});

// Sign in form submission
signInForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = signInEmailInput.value.trim();

    if (email) {
        setSignInStatus('');
        signInSubmitBtn.disabled = true;
        signInSubmitBtn.textContent = 'Loading…';

        const { progress, reason } = await fetchProgress(email);

        signInSubmitBtn.disabled = false;
        signInSubmitBtn.textContent = 'Load progress';

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
            track('sign_in_failed', { reason: failure });
        }
    }
});

// Cancel sign in
cancelSignInBtn.addEventListener('click', () => {
    hideSignInModal();
});

// Welcome modal - Continue button
document.getElementById('continueBtn').addEventListener('click', async () => {
    const storedEmail = getStoredEmail();
    if (storedEmail) {
        const progress = await loadProgress(storedEmail);
        if (progress) {
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
