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
const skipSignupBtn = document.getElementById('skipSignupBtn');
const cancelSignInBtn = document.getElementById('cancelSignInBtn');
const donationButton = document.getElementById('donationButton');
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
        if (window.plausible) {
            window.plausible('Progress Save Attempt', { props: { source: sourceSlug } });
        }
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

async function loadProgress(email) {
    try {
        const response = await fetch(`/api/progress/${encodeURIComponent(email)}`);
        const data = await response.json();

        if (data.exists) {
            return data.progress;
        }
        return null;
    } catch (error) {
        console.error('Error loading progress:', error);
        return null;
    }
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
    if (window.plausible) {
        window.plausible('Signup Modal Shown');
    }
}

function hideSignupModal() {
    signupModal.classList.add('hidden');
}

function showSignInModal() {
    signInModal.classList.remove('hidden');
    if (window.plausible) {
        window.plausible('Sign-In Modal Shown');
    }
}

function hideSignInModal() {
    signInModal.classList.add('hidden');
    signInEmailInput.value = '';
}

function showWelcomeModal(email, progress) {
    document.getElementById('welcomeEmail').textContent = email;
    document.getElementById('progressInfo').textContent =
        `Resume from question ${progress.currentQuestionIndex + 1} (Score: ${progress.score}/${progress.answered})`;
    welcomeModal.classList.remove('hidden');
    if (window.plausible) {
        window.plausible('Welcome Modal Shown');
    }
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

// Show donation button after 10 questions
function showDonationButton() {
    if (answered >= 10) {
        donationButton.classList.remove('hidden');
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
        if (window.plausible) {
            window.plausible('Donate Click', { props: { provider: 'mobilepay' } });
        }

        // Open MobilePay link
        window.open('https://qr.mobilepay.fi/box/fc157323-1b1a-4061-afd6-cfd06965788d/pay-in', '_blank', 'noopener');
    } catch (error) {
        console.error('Error logging donation click:', error);
        // Still open the link even if logging fails
        window.open('https://qr.mobilepay.fi/box/fc157323-1b1a-4061-afd6-cfd06965788d/pay-in', '_blank', 'noopener');
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
            if (window.plausible) {
                window.plausible('Answer Correct', { props: { topic: result.topic } });
            }

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
            if (window.plausible) {
                window.plausible('Answer Incorrect', { props: { topic: result.topic } });
            }

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

        // Check if we should show donation button (after 10 questions)
        showDonationButton();

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

    Object.entries(topicStats).forEach(([topic, stats]) => {
        const topicPercentage = Math.round((stats.correct / stats.total) * 100);
        const topicItem = document.createElement('div');
        topicItem.className = 'topic-item';
        topicItem.innerHTML = `
            <span>${topic}</span>
            <span><strong>${stats.correct}/${stats.total}</strong> (${topicPercentage}%)</span>
        `;
        topicBreakdown.appendChild(topicItem);
    });
}

// Restart quiz
document.getElementById('restartBtn').addEventListener('click', async () => {
    currentQuestionIndex = 0;
    score = 0;
    answered = 0;
    topicStats = {};
    hasShownSignup = false;
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
        updateSignInButton();

        // Save current progress to server
        const success = await saveProgress(email);

        if (success) {
            if (window.plausible) {
                window.plausible('Progress Save Success', { props: { source: sourceSlug } });
            }
            hideSignupModal();
            // Show a brief success message
            feedbackText.textContent = '✓ Progress saved! You can now close and return anytime.';
            feedback.classList.remove('incorrect');
            feedback.classList.add('correct');
            feedback.classList.remove('hidden');
        } else {
            if (window.plausible) {
                window.plausible('Progress Save Failed', { props: { source: sourceSlug } });
            }
            alert('Failed to save progress. Please try again.');
        }
    }
});

// Skip signup button
skipSignupBtn.addEventListener('click', () => {
    hideSignupModal();
    // Continue with the quiz without saving
    if (window.plausible) {
        window.plausible('Signup Skipped');
    }
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
        const progress = await loadProgress(email);

        if (progress && progress.currentQuestionIndex < questions.length) {
            userEmail = email;
            setStoredEmail(email);
            updateSignInButton();
            hideSignInModal();
            showWelcomeModal(email, progress);
        } else {
            alert('No saved progress found for this email.');
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
    if (window.plausible) {
        window.plausible('Resume Continue');
    }
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
    if (window.plausible) {
        window.plausible('Resume Start Fresh');
    }
});

// Donation button event listener
donateBtn.addEventListener('click', handleDonationClick);

// Initialize app
loadQuestions();
