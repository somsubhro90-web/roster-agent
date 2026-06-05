export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { messages, teamData, currentDate } = req.body;

  const today = new Date(currentDate);
  const quarter = Math.floor(today.getMonth() / 3);
  const isQ1orQ3 = quarter === 0 || quarter === 2;

  const team1WeekOff = isQ1orQ3 ? 'Monday to Wednesday' : 'Thursday to Saturday';
  const team2WeekOff = isQ1orQ3 ? 'Thursday to Saturday' : 'Monday to Wednesday';

  const systemPrompt = `You are a helpful roster management agent for a team. Today's date is ${today.toDateString()}.

TEAM STRUCTURE:
Team 1 members and their shifts:
${teamData.team1.members.map(m => `- ${m.name}: ${m.shift} (${m.shift === 'L1' ? '6am-4pm IST' : '8am-6pm IST'})`).join('\n')}
Team 1 week-off: ${team1WeekOff} (both days off, Sundays they work)

Team 2 members and their shifts:
${teamData.team2.members.map(m => `- ${m.name}: ${m.shift} (${m.shift === 'L1' ? '6am-4pm IST' : '8am-6pm IST'})`).join('\n')}
Team 2 week-off: ${team2WeekOff} (both days off, Sundays they work)

LEAVE TYPES: vacation, sick, comp-off

YOUR CAPABILITIES:
1. Answer questions about who is working on any given day/shift
2. Help log leave requests - when a user wants to log a leave, respond with a JSON action block at the end of your message like this:
   ACTION:{"type":"log_leave","member":"Name","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","leaveType":"sick|vacation|comp-off"}
3. Help cancel leaves - use: ACTION:{"type":"cancel_leave","member":"Name","date":"YYYY-MM-DD"}
4. Flag understaffing when multiple people from the same team are on leave on the same day

Always be concise, helpful, and confirm the details before logging. When computing schedules, remember week-offs rotate every calendar quarter (Q1&Q3: Team1 off Mon-Wed, Team2 off Thu-Sat | Q2&Q4: Team1 off Thu-Sat, Team2 off Mon-Wed). Sundays are always working days for both teams.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages
      })
    });

    const data = await response.json();
    const reply = data.content[0].text;

    // Parse and execute any ACTION blocks
    const actionMatch = reply.match(/ACTION:(\{.*\})/);
    if (actionMatch) {
      try {
        const action = JSON.parse(actionMatch[1]);
        await executeAction(action, req);
      } catch(e) {
        console.error('Action parse error:', e);
      }
    }

    // Return reply with ACTION block stripped for cleaner display
    const cleanReply = reply.replace(/ACTION:\{.*\}/, '').trim();
    res.json({ reply: cleanReply });

  } catch(e) {
    console.error(e);
    res.status(500).json({ reply: 'Something went wrong. Please try again.' });
  }
}

async function executeAction(action, req) {
  const { kv } = await import('@vercel/kv');

  if (action.type === 'log_leave') {
    const existing = await kv.get('leaves') || [];
    existing.push({
      id: Date.now(),
      member: action.member,
      startDate: action.startDate,
      endDate: action.endDate,
      type: action.leaveType,
      status: 'approved',
      loggedAt: new Date().toISOString()
    });
    await kv.set('leaves', existing);
  }

  if (action.type === 'cancel_leave') {
    const existing = await kv.get('leaves') || [];
    const updated = existing.filter(l =>
      !(l.member.toLowerCase() === action.member.toLowerCase() &&
        action.date >= l.startDate && action.date <= l.endDate)
    );
    await kv.set('leaves', updated);
  }
}
