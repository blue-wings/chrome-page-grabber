/**
 * Simple token estimator for LLM context windows.
 * English: ~1 token per 4 characters
 * Chinese/CJK: ~1 token per 1.5 characters
 */
const TokenEstimator = {
  // Regex to match CJK characters
  CJK_REGEX: /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef\u2e80-\u2eff\u3100-\u312f\u31a0-\u31bf\ua490-\ua4cf\u2f00-\u2fdf]/g,

  estimate(text) {
    if (!text) return 0;
    const cjkMatches = text.match(this.CJK_REGEX);
    const cjkCount = cjkMatches ? cjkMatches.length : 0;
    const nonCjkText = text.replace(this.CJK_REGEX, '');
    const nonCjkTokens = Math.ceil(nonCjkText.length / 4);
    const cjkTokens = Math.ceil(cjkCount / 1.5);
    return nonCjkTokens + cjkTokens;
  },

  format(tokens) {
    return '≈ ' + tokens.toLocaleString() + ' tokens';
  },

  getWarning(tokens) {
    if (tokens > 128000) return '超出 128K 限制，建议分段';
    if (tokens > 32000) return '超出 32K 限制（部分模型）';
    if (tokens > 8000) return '超出 8K 限制（部分模型）';
    return '';
  }
};

if (typeof module !== 'undefined') module.exports = TokenEstimator;
