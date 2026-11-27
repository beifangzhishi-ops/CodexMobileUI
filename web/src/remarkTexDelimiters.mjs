/** Add TeX delimiters alongside remark-math's dollar syntax. */
export function remarkTexDelimiters() {
  const data = this.data();
  (data.micromarkExtensions ??= []).push({
    text: { 92: { name: 'texDelimitedMath', tokenize } },
  });
  (data.fromMarkdownExtensions ??= []).push({
    enter: {
      texDelimitedMath(token) {
        this.enter({
          type: 'inlineMath',
          value: '',
          data: { hName: 'code', hProperties: {}, hChildren: [] },
        }, token);
      },
    },
    exit: {
      texDelimitedMath(token) {
        const source = this.sliceSerialize(token);
        const node = this.stack[this.stack.length - 1];
        node.value = source.slice(2, -2).trim();
        node.data.hProperties.className = [source[1] === '[' ? 'math-display' : 'math-inline'];
        node.data.hChildren.push({ type: 'text', value: node.value });
        this.exit(token);
      },
    },
  });
}

function tokenize(effects, ok, nok) {
  let closing;
  let hasContent = false;
  return start;

  function start(code) {
    effects.enter('texDelimitedMath');
    effects.consume(code);
    return open;
  }

  function open(code) {
    if (code !== 40 && code !== 91) return nok(code); // ( or [
    closing = code === 40 ? 41 : 93;
    effects.consume(code);
    return body;
  }

  function body(code) {
    if (code === null || code < -2) return nok(code);
    effects.consume(code);
    if (code === 92) return escape;
    if (code > 32) hasContent = true;
    return body;
  }

  function escape(code) {
    if (code === closing && hasContent) {
      effects.consume(code);
      effects.exit('texDelimitedMath');
      return ok;
    }
    if (code === 92) {
      effects.consume(code);
      hasContent = true;
      return body;
    }
    if (code === 40 || code === 91 || code === closing) return nok(code);
    return body(code);
  }
}
