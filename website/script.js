document.addEventListener('DOMContentLoaded', () => {
  // Copy to clipboard functionality
  const copyBtn = document.getElementById('copyBtn');
  const tooltip = document.querySelector('.copy-tooltip');
  const commandText = 'npm install @1a8jkf/universal-resilience-toolkit';

  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(commandText).then(() => {
      tooltip.classList.add('show');
      setTimeout(() => {
        tooltip.classList.remove('show');
      }, 2000);
    });
  });

  // Extremely basic syntax highlighting for the code block
  const codeBlock = document.querySelector('.language-typescript');
  if (codeBlock) {
    let html = codeBlock.innerHTML;

    // Keywords
    html = html.replace(
      /\b(import|from|const|await|async|if|throw|new|return)\b/g,
      '<span class="token-keyword">$1</span>',
    );

    // Strings
    html = html.replace(/('[^']*')/g, '<span class="token-string">$1</span>');

    // Properties and functions
    html = html.replace(
      /\b(withResilience|fetch|Error)\b/g,
      '<span class="token-function">$1</span>',
    );
    html = html.replace(
      /\b(key|retry|rateLimit|circuitBreaker|maxAttempts|backoff|tokensPerInterval|interval|failureThreshold|resetTimeout|status)\b(?=\s*:|\.)/g,
      '<span class="token-property">$1</span>',
    );

    // Comments
    html = html.replace(/(\/\/.*)/g, '<span class="token-comment">$1</span>');

    codeBlock.innerHTML = html;
  }
});
