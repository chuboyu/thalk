---
key: multiplied-not-optimized
lang: en
title: "Multiplied, not Optimized"
description: "Why small improvements lead to great transmutations, and how best choices drag you down and block your next leap." 
date: 2026-07-15
draft: false               # flip to false to publish
tags: [thesis, choice]
syndicate: [email]
provenance: original
authorship: human
# model: [claude-fable-5] # model(s) used — string or list; names them in the banner/chip
# solo: true              # set if this piece is intentionally one language only
# base, translatedAt, baseHash          # only for machine/reviewed versions
---

LLM-based AI coding agents have been booming for a while, and you know it when all of your non-coder friends are generating code and deploying services. 
For software engineers, this is natural: "someone" can do their job for them, freeing up time for higher-value work. Interestingly, there is a huge gap between the addicted and the reluctant coders.

I myself, like other heavy users, have experienced nearly a 100x boost in delivering outcomes, while some others report that this hardly changes their lives.

The mismatch is stark, and it reminds me of the time when I first learned how to ride a bicycle on my own. The wind soaring past my hair, and I could "sprint" far faster than I could ever run. The sense of freedom rushing through my veins, making me feel like I could go anywhere.

"This is great," I told my dad.
"It truly is," he replied, "But don't limit yourself from other greatness. You'll also learn to ride a motorcycle, drive a car, or even fly a plane or launch rockets."
He paused, and said the words that are still a core part of me.

**"You can't reach the stars by mastering the art of bike riding."**

So what does utilizing coding agents have to do with this?

You would think that the gap emerges from how effectively people are utilizing this new "tool" or from a lack of corresponding domain knowledge. However, my chats with many people, both coders and non-coders, all reflect a similar speed-up magnitude (roughly 10x) for specific tasks, and still requires human supervision if you wish to maintain a certain quality. In my own experience, an implementation that used to take 3 days to complete is now roughly 3 hours. This is, of course, already a huge improvement, but obviously far from the 100x boost some of us experience.

So what's different? Are my claims contradictory?

No, and with more radical thinking, I believe that the boost can go up to 1000x under the correct (but rare) condition. The gap comes from how you evaluate the speed improvement. Implementing a single feature is one thing, and delivering comprehensive outcomes is another. If I define this AI merely as a "code generator" then the best I am getting is a 10x boost.

But a delivery is not just printing code.

If you view LLMs as a "re-structuring method," apply this to all possible parts of the cycle, and measure the end-to-end outcome, the whole perspective changes. You are not "outsourcing" your skills to a tool, but "re-establishing" the progressive loops. At first, the observations might be disappointing: your speed-up is less pronounced, and now it takes 6 hours to finish the task due to the overhead of transforming information between different stages of the cycle. However, this overhead is a short-term penalty for a massive long-term gain. You are sacrificing a bit of raw coding speed to generate the collateral (docs, tests, alignment) that ultimately saves weeks of human back-and-forth.

Then the magic starts to work. Though "sub-optimal" for the coding phase alone, it's still a 4-5x boost, but that boost is now applying to other parts of the work: doc drafting, context management, system alignment, spec checks, design reviews, tests, and security checks, you name it. And the best part is, some of these can now be executed in parallel if you get the workflow design right—which is also doable with this new method.

Furthermore, in the context of an entire development cycle, the actual difference between a 3-hour and a 6-hour coding task is negligible. Consider the traditional flow involving multiple stakeholders. A 2-week sprint is the dream. In reality, you have to align schedules, do surveys, generate reports, and wait for feedback, especially in high-context environments. The major bottleneck is not the hours spent coding, but the pace alignment. Three days of work is actually one week when considering the human buffer. And you need another week for story points, reviews, meetings, debates, and explaining everyone's thoughts.

Now, everything fits into one, at most two days. The 6-hour implementation allows you to fit the code changes into one day and get immediate feedback that same day. Capturing everything during execution keeps your documents always updated, turning them into part of the review process and kick-off in parallel. You can easily accommodate your stakeholders' schedules since you can execute in fragments, showing whatever you have, and prompt your system into the next stage before the weekend.

A feature that used to need 3 sprints (6 weeks) is now done in 2 days, allowing you to focus on whoever is present and work on multiple tasks at the same time.

All of this wouldn't happen if you get tunnel vision and focus solely on how many hours you can shave off a single task. That is optimization. Optimization is for well-scoped, proficiency-oriented problems. But when facing a methodological change, the question is not "how fast are you producing?" but "how are you producing?" Every small improvement compounds, accumulating into a massive multiplier on the overall cycle.

This compounding effect is fundamentally different. The final outcome will never be achieved through pure optimization alone. Using an AI to simply write code faster is mastering the bicycle; restructuring your entire delivery pipeline to multiply those gains—that is how you build the rocket.