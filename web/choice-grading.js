/* Shared rules for reliable single-choice answers. No answer-text guessing. */
(function (global) {
  const label = (question, index) => String(question.options?.[index]?.label || String.fromCharCode(65 + index)).trim().toUpperCase();
  function answer(question) {
    if (question.type === 'multiple_choice' || !Array.isArray(question.options) || !question.options.length || !Array.isArray(question.correct_labels) || question.correct_labels.length !== 1) return null;
    const correct = String(question.correct_labels[0]).trim().toUpperCase();
    const labels = question.options.map((_, i) => label(question, i));
    return correct && new Set(labels).size === labels.length && labels.includes(correct) ? correct : null;
  }
  function grade(question, selected) {
    const correct = answer(question);
    if (!correct || selected.size !== 1) return null;
    return [...selected][0] === correct;
  }
  function patch(ok, current, favorite, at = Date.now()) {
    return { mastery: ok ? 'mastered' : 'learning', favorite: ok ? favorite === true : true,
      error_prone: ok ? current.error_prone === true : true,
      seen: true, answered: true, last_ok: ok, last_practiced_at: at };
  }
  function feedback(container, ok) {
    let result = container.querySelector('.choice-feedback');
    if (ok == null) { result?.remove(); return; }
    if (!result) { result = document.createElement('p'); result.className = 'choice-feedback'; result.setAttribute('role', 'status'); container.appendChild(result); }
    result.dataset.result = ok ? 'correct' : 'incorrect';
    result.textContent = ok ? '回答正确' : '回答错误，请查看答案与解析';
  }
  global.ChoiceGrading = Object.freeze({ label, answer, grade, patch, feedback });
})(globalThis);
