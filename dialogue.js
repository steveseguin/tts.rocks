// Speaker labels are editing instructions, never spoken text.
export function parseDialogue(text, maxTurns = 100) {
    const turns = [];
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const match = line.match(/^\s*([AB]):\s*(.*)$/i);
        if (!match && /^\s*[A-Z]:/i.test(line)) throw new Error('Use A: or B: for speaker labels.');
        if (match) turns.push({ speaker: match[1].toUpperCase(), text: match[2].trim() });
        else if (turns.length) turns[turns.length - 1].text += '\n' + line.trim();
        else throw new Error('Start each speaker turn with A: or B:.');
    }
    if (!turns.length || turns.some(turn => !turn.text)) throw new Error('Add text after every A: or B: label.');
    if (turns.length > maxTurns) throw new Error(`Use at most ${maxTurns} speaker turns per recording.`);
    return turns;
}

export function dialogueVtt(cues) {
    const time = seconds => {
        const ms = Math.round(seconds * 1000);
        return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
    };
    const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    return 'WEBVTT\n\n' + cues.map((cue, index) => `${index + 1}\n${time(cue.start)} --> ${time(cue.end)}\n${cue.speaker ? `<v Speaker ${cue.speaker}>` : ''}${escape(cue.text).replace(/\n+/g, ' ')}\n`).join('\n');
}
