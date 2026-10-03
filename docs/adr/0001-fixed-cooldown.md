# Fixed 15-minute cooldown per town, missiles excepted

Replaced the sliding 30-minute "one message per raid" window. Every post extended that window, so during a long raid it never closed, and a second threat was never sent: on 2026-10-03 a БпЛА heading to Ладижин at 00:09 was dropped as a follow-up of the 00:01 jet drone. A town now goes loud on a confirmed post, then stays silent for a fixed 15 minutes counted from that alert. Posts inside the cooldown don't extend it, and confidence starts fresh once it ends. Missile and КАБ posts (`config/threat-fast.json`) get through a cooldown and restart it, because they reach a town in minutes.

## Considered Options

- **Send every post, follow-ups silent.** Gives a full timeline without waking you each time, but brings back the cluttered chat the window was added to prevent (four Ладижин messages, two in the same minute).
- **Tell a new threat apart from a repeat** (threat type, count, direction). This is what we actually want. It was rejected in favour of a simpler rule. The cooldown accepts that a new drone less than 15 minutes after the last alert is not sent.
