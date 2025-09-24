export function mapOllamaOptionsToBridge(ollamaOptions) {
    if (!ollamaOptions)
        return undefined;
    const out = {};
    // Map only the supported ones
    if (typeof ollamaOptions.temperature === 'number')
        out.temperature = ollamaOptions.temperature;
    if (typeof ollamaOptions.num_predict === 'number')
        out.maxOutputTokens = Math.max(1, Math.floor(ollamaOptions.num_predict));
    return Object.keys(out).length ? out : undefined;
}
export function foldSystemIntoPrompt(system, prompt) {
    if (!system)
        return prompt;
    const sys = system.trim();
    if (!prompt)
        return sys ? `System: ${sys}` : undefined;
    return sys ? `System: ${sys}\n\n${prompt}` : prompt;
}
export function mapOllamaChatToBridgeMessages(messages) {
    const out = [];
    let systemBuffer = '';
    for (const m of messages) {
        if (m.role === 'system') {
            systemBuffer += (systemBuffer ? '\n' : '') + m.content;
            continue;
        }
        let content = m.content;
        if (systemBuffer) {
            content = `System: ${systemBuffer}\n\n${content}`;
            systemBuffer = '';
        }
        if (m.role === 'assistant')
            out.push({ role: 'assistant', content });
        else if (m.role === 'user' || m.role === 'tool')
            out.push({ role: 'user', content: m.role === 'tool' ? `Tool: ${content}` : content });
    }
    if (systemBuffer) {
        out.unshift({ role: 'user', content: `System: ${systemBuffer}` });
    }
    return out;
}
//# sourceMappingURL=mapping.js.map