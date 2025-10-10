let questions = [];
let currentQuestionIndex = 0;
let score = 0;
let answered = 0;
let topicStats = {};

// DOM Elements
const questionText = document.getElementById('questionText');
const topicBadge = document.getElementById('topicBadge');
const optionsContainer = document.getElementById('optionsContainer');
const feedback = document.getElementById('feedback');
const feedbackText = document.getElementById('feedbackText');
const searchSuggestion = document.getElementById('searchSuggestion');
const searchLink = document.getElementById('searchLink');
const nextBtn = document.getElementById('nextBtn');
const questionCounter = document.getElementById('questionCounter');
const scoreCounter = document.getElementById('scoreCounter');
const progressBar = document.getElementById('progressBar');
const quizContainer = document.getElementById('quizContainer');
const resultsContainer = document.getElementById('resultsContainer');

// Load questions from API
async function loadQuestions() {
    try {
        const response = await fetch('/api/questions');
        questions = await response.json();
        console.log(`Loaded ${questions.length} questions`);
        displayQuestion();
    } catch (error) {
        console.error('Error loading questions:', error);
        questionText.textContent = 'Error loading questions. Please refresh the page.';
    }
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

    // Update question
    questionText.textContent = question.question;
    topicBadge.textContent = question.topic;

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
        answered++;

        // Track topic statistics
        if (!topicStats[result.topic]) {
            topicStats[result.topic] = { correct: 0, total: 0 };
        }
        topicStats[result.topic].total++;

        // Show feedback
        if (result.correct) {
            score++;
            topicStats[result.topic].correct++;
            feedback.classList.remove('incorrect');
            feedback.classList.add('correct');
            feedbackText.textContent = '✓ Correct! Well done!';

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

        feedback.classList.remove('hidden');
        nextBtn.classList.remove('hidden');

    } catch (error) {
        console.error('Error checking answer:', error);
        feedbackText.textContent = 'Error checking answer. Please try again.';
        feedback.classList.remove('hidden');
    }
}

// Move to next question
nextBtn.addEventListener('click', () => {
    currentQuestionIndex++;
    displayQuestion();
});

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
document.getElementById('restartBtn').addEventListener('click', () => {
    currentQuestionIndex = 0;
    score = 0;
    answered = 0;
    topicStats = {};
    resultsContainer.classList.add('hidden');
    quizContainer.classList.remove('hidden');
    displayQuestion();
});

// Initialize app
loadQuestions();
