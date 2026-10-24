import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { GuideCta } from "./guide-cta";
import { HandCircle, Highlight, PenNote, Underline } from "@/components/landing/notebook";

// One static page for everyone: it does not read the session on the server. (A page that waited on the session while
// streaming a 160 KB document sometimes hydrated twice in a browser under load: "Hydration failed", and the theme
// attribute on <html> was lost. See TODOS.md.) Who is looking is decided in the browser, in the header and the closing box.
export const metadata = {
  title: "How Idea HQ works",
  description:
    "A plain-language guide to Idea HQ: set up a project, write ideas, let the AI build them in your own GitHub, review and merge, and what it costs.",
  alternates: { canonical: "/guide" },
};

const TOC = [
  ["what", "What Idea HQ is"],
  ["loop", "The big picture"],
  ["words", "Words used here"],
  ["before", "Before you start"],
  ["setup", "Setup, step by step"],
  ["knows", "How the AI learns your project"],
  ["first", "Your first AI change"],
  ["daily", "Everyday use"],
  ["ideas", "Writing good ideas"],
  ["board", "Your board and Focus"],
  ["safe", "Staying in control"],
  ["cost", "What it costs"],
  ["support", "Support for your own users"],
  ["changes", "A public What's new page"],
  ["stuck", "If you get stuck"],
];

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div className="mt-12 mb-3">
      <h2 id={id} className="text-2xl font-semibold scroll-mt-20">{children}</h2>
      <Underline className="mt-1 hidden light:block" />
    </div>
  );
}
const P = ({ children }: { children: React.ReactNode }) => <p className="text-gray-700 dark:text-gray-300 leading-relaxed mt-3">{children}</p>;
const UL = ({ children }: { children: React.ReactNode }) => <ul className="list-disc pl-5 space-y-1.5 mt-3 text-gray-700 dark:text-gray-300">{children}</ul>;
const Tip = ({ children }: { children: React.ReactNode }) => (
  <div className="mt-4 rounded-lg border border-emerald-300/60 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 light:border-2 light:border-gray-900 light:bg-emerald-100 light:text-gray-900 p-3 text-sm text-emerald-900 dark:text-emerald-200">{children}</div>
);

// The light theme draws each step number inside a hand-drawn ring, as on the start page.
const RINGS = [
  "M33 6C17 5 6 17 7 33s14 26 28 25 23-12 22-27S45 6 30 9",
  "M30 7C15 8 5 20 7 35s16 24 30 22 22-14 20-28S44 6 28 10",
  "M34 6C18 6 6 18 8 34s15 25 29 23 21-13 20-27S46 7 31 9",
];

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 mt-5">
      <span className="shrink-0 w-7 h-7 rounded-full bg-emerald-700 text-white text-sm font-medium flex items-center justify-center mt-0.5 light:hidden">{n}</span>
      <span className="hidden light:block shrink-0 -mt-0.5"><HandCircle n={n} d={RINGS[n % 3]} size={36} /></span>
      <div>
        <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
        <div className="text-gray-700 dark:text-gray-300 leading-relaxed mt-1 text-[15px]">{children}</div>
      </div>
    </li>
  );
}

function Q({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="mt-3 rounded-lg border border-gray-200 bg-white dark:bg-transparent dark:border-gray-700 light:border-gray-300 p-3 group">
      <summary className="cursor-pointer font-medium text-gray-900 dark:text-white">{q}</summary>
      <div className="mt-2 text-gray-700 dark:text-gray-300 text-[15px] leading-relaxed">{children}</div>
    </details>
  );
}

export default function GuidePage() {
  return (
    <div className="nb-skin nb-grid relative min-h-screen overflow-hidden bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100">
      {/* The red margin line of the start page, only where it clears the text. */}
      <div aria-hidden="true" className="absolute inset-y-0 left-[72px] w-0.5 bg-[#F1B5AE] hidden min-[1100px]:light:block" />
      <SiteHeader />
      <main className="relative max-w-3xl mx-auto px-4 pt-10">
        <PenNote rotate={-2} className="hidden light:inline-block text-[19px] font-medium leading-[1.2] mb-2">read me first</PenNote>
        <h1 className="text-4xl font-bold tracking-tight">
          How Idea HQ <span className="hidden light:inline"><Highlight>works</Highlight></span><span className="light:hidden">works</span>
        </h1>
        <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">
          A plain-language guide. No technical background needed. Keep this page handy: it is the answer to most &quot;what do I do now?&quot; moments.
        </p>

        <nav aria-label="Contents" className="mt-6 rounded-xl border border-gray-200 bg-white dark:bg-transparent dark:border-gray-700 p-4">
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">On this page</p>
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
            {TOC.map(([id, label]) => (
              <li key={id}><a href={`#${id}`} className="text-emerald-600 hover:underline">{label}</a></li>
            ))}
          </ul>
        </nav>

        <H id="what">What Idea HQ is</H>
        <P>
          Idea HQ is a notebook for the ideas behind your projects, with an AI helper that can turn an idea into a real change in your project. You write what you want. The AI works out how big it is, writes a plan, builds it, and tests it. Then you look at the result and decide if it goes live.
        </P>
        <P>
          It is not a website builder and it does not run your app. Your project stays where it already lives, on GitHub. Idea HQ just helps you plan and build changes to it, safely.
        </P>

        <H id="loop">The big picture</H>
        <ol className="mt-3 space-y-2 text-gray-700 dark:text-gray-300 list-decimal pl-5">
          <li><b>You write an idea.</b> Plain words are fine.</li>
          <li><b>The AI sizes it.</b> Quick, Standard, Large or Epic, by the work the AI has to do (minutes and cost), not by how long a person would need.</li>
          <li><b>The AI writes a plan</b> (called the build prompt). You can read and approve it.</li>
          <li><b>The AI builds it</b> in a safe copy of your project, and runs your checks.</li>
          <li><b>You review the result</b> as a &quot;pull request&quot; (a proposed change you can read).</li>
          <li><b>You approve it</b> and it joins your real project, or you ask for changes, or you close it.</li>
        </ol>
        <Tip>Nothing the AI builds goes live until you approve it, unless you turn on auto-merge for a project (it is off by default).</Tip>

        <H id="words">Words used here</H>
        <dl className="mt-3 space-y-3 text-gray-700 dark:text-gray-300">
          {[
            ["Project", "One product or codebase of yours, like \"My webshop\". Ideas belong to a project."],
            ["Idea", "Something you want to change or add, written in plain words."],
            ["Size", "How much work an idea is for the AI: Quick (4 to 8 minutes, $0.01 to $0.05), Standard (6 to 15 minutes, $0.10 to $0.60), Large (12 to 30 minutes, $0.50 to $2.50) or Epic (too big for one run: split it into steps first). These are typical ranges; real runs vary. Once you have run at least three changes of a size, the idea page also shows what your own last runs of that size took, so you can trust your own numbers over the defaults."],
            ["Build prompt", "The short brief the AI follows for an idea: which files to change, which checks to run, and what done looks like. It has no git steps, because the workflow does those."],
            ["GitHub", "The website where your project's code is stored. Think of it as cloud storage for code that remembers every change."],
            ["Repo (repository)", "Your project's folder on GitHub."],
            ["Branch", "A separate copy of your project to try changes in, so the real one stays untouched. \"main\" is usually the real one."],
            ["Pull request (PR)", "A proposed change. It shows exactly what was added and removed, and waits for your yes or no."],
            ["Merge", "Saying yes: the proposed change joins the real project."],
            ["Checks", "Automatic tests that run on a change, like a spell-check for code. Green means passed, red means a problem."],
            ["API key", "A long secret password that lets the AI work and bills the usage to your own Anthropic or OpenAI account. Keep it private."],
            ["Turn", "One step the AI takes, such as reading a file, changing it or running a command. Every run has a limit on turns, so it cannot go on forever."],
            ["Workflow", "A small file in your project that lets GitHub run the AI for you. Idea HQ adds it through a pull request you approve once."],
          ].map(([t, d]) => (
            <div key={t}><dt className="font-semibold text-gray-900 dark:text-white">{t}</dt><dd>{d}</dd></div>
          ))}
        </dl>

        <H id="before">Before you start</H>
        <UL>
          <li><b>A GitHub account.</b> Free. Your project&apos;s code needs to be on GitHub already.</li>
          <li><b>An API key from Anthropic (Claude) or OpenAI.</b> Make one at console.anthropic.com or platform.openai.com. It is how the AI is paid for: the usage is billed straight to your own account, so set a small monthly spending limit while you learn. A ChatGPT or Claude subscription does not include an API key. Gemini is coming soon.</li>
          <li><b>A JavaScript or TypeScript project that uses npm.</b> Idea HQ runs your project&apos;s own npm scripts to build and test. Other kinds of projects have not been tried yet, so start with a small one.</li>
          <li><b>An approved Idea HQ account.</b> When you sign up, you pass a short &quot;are you a person&quot; check and we email you a link. Open it and press <b>Confirm my email</b> so the owner knows the address is yours. Then the owner approves you, and you do not have to do anything while you wait.</li>
        </UL>

        <H id="setup">Setup, step by step</H>
        <P>
          On the Projects page, a project that is not finished shows a green <b>Set up this project</b> button with how many steps are done. It takes you straight to the next step. Once the project says <b>AI ready</b>, <b>Project knowledge</b> becomes the main button instead.
        </P>
        <P>The app walks you through this and ticks each step off by itself. This is what you will see and why.</P>
        <ol>
          <Step n={1} title="Create your first project">Give it a name. It is only a label for you.</Step>
          <Step n={2} title="Connect GitHub">Click Connect GitHub. GitHub asks you to sign in and allow the app. You choose which repos it may see. Pick only the ones you want to use with Idea HQ. You can change this later in GitHub, under Settings, Applications.</Step>
          <Step n={3} title="Choose the repo and the branch">Pick your project&apos;s repo. For the branch, enter the one that holds your real project, usually <code className="px-1 rounded bg-gray-100 dark:bg-gray-800">main</code>. The AI&apos;s changes will be proposed against it.</Step>
          <Step n={4} title="Set the build and test commands">These are the commands that build your project and test a change (the checks). The app suggests them from your project, so just click Use them. If you do not know, leaving them empty works, but then nothing tests the AI&apos;s work.</Step>
          <Step n={5} title="Install the workflow">Click the button. Idea HQ opens a pull request in your repo that adds one small file. Open it on GitHub and click Merge. You only do this once per project. It is the file that lets GitHub run the AI for you, with a time limit.</Step>
          <Step n={6} title="Add your API key to the repo">The easiest way is to paste your key into the box in the app: it checks that the key works, saves it in your repo as a secret, and forgets it. Or add it yourself: open the page the app links to. It must be a <b>Secret</b> (the Secrets tab), never a Variable: variables are shown in plain text. Name it <code className="px-1 rounded bg-gray-100 dark:bg-gray-800">ANTHROPIC_API_KEY</code> (<code className="px-1 rounded bg-gray-100 dark:bg-gray-800">OPENAI_API_KEY</code> if you chose OpenAI), paste your key, and save. The key stays in GitHub. Idea HQ never sees it.</Step>
          <Step n={7} title="Teach the AI about your project">Click Read my repo and describe it. The AI looks through your project and writes down what it is, how it is built and how to run it. Read it, then click This looks right, or fix what is wrong. A good description makes every later estimate and plan better. The next section explains how to improve it further.</Step>
        </ol>
        <Tip>Several projects? On a personal GitHub account the key has to be added to each repo once. The app gives you a one-line command to add it to all of them at once.</Tip>

        <H id="knows">How the AI learns your project</H>
        <P>
          The AI can only do good work if it understands your project. Idea HQ keeps a page for that: open Projects and click <b>Project knowledge</b> (it shows a percentage, such as 60%) on any project. It shows what the AI knows, in six plain topics: what it is, the technology, how it is organised, how to run and ship it, rules, and known quirks. Each topic says whether it is <b>Missing</b>, <b>Needs review</b> or <b>Confirmed</b>, and where it came from.
        </P>
        <UL>
          <li><b>Quick draft from my repo:</b> reads the key files in seconds and fills in what it can see. Safe to repeat. It never overwrites what you wrote or confirmed.</li>
          <li><b>Learn deeply in my GitHub:</b> the AI explores your whole project inside your own GitHub, like a new teammate reading the code. It takes a few minutes, uses your Anthropic key (usually under a dollar), and what it writes appears on the page marked Needs review.</li>
          <li><b>Answer a few questions:</b> optional. The AI asks plain questions about the gaps, like what must never change, and adds your answers.</li>
          <li><b>This is right / Edit:</b> check each topic, or press <b>Looks right, confirm all</b> once you have read them. Anything you edit or confirm is protected, so the AI will not overwrite it later.</li>
          <li><b>Save a copy in my repo:</b> opens a pull request that adds the knowledge to your project as a text file, so other AI tools you use start with the same understanding. Idea HQ always keeps its own copy too.</li>
          <li><b>What it learns over time:</b> after each change, Idea HQ notes what shipped, what you asked to be fixed, and what failed. You can pin the ones that matter, add your own rules, or delete any.</li>
        </UL>
        <Tip>If an estimate or plan feels off, the knowledge is usually the reason. Open the page, fix the topic that is wrong or missing, and generate the plan again.</Tip>

        <P>
          <b>Keeping it current:</b> when a project&apos;s repo has moved on by 20 or more commits since the AI last learned it, Idea HQ asks whether to scan it again. You see the question on the Projects page, on the project knowledge page (with a free quick scan and a deeper one), and above the plan on an idea. Topics you have confirmed stay as you wrote them. Projects whose installed workflow is older than the newest one also show an optional <b>Update the workflow</b> button on their setup page.
        </P>

        <H id="first">Your first AI change</H>
        <P>Start tiny, so you learn the loop cheaply. The practice idea (add one line to the README) is perfect.</P>
        <P>
          At the top of every idea you set its <b>priority</b> and <b>value</b>. Under that is a card with five stages: <b>Describe</b>, <b>Plan</b>, <b>Build</b>, <b>Review</b> and <b>Ship</b>. It always has one main button for the next step. <b>Plan it</b> sizes the idea and writes the plan for you; you can also pick the <b>Size</b> yourself. <b>Build it</b> shows what the build typically costs and takes, and, once you have run a few changes of that size, what your own last ones took (minutes and cost), and pressing it is your approval to start. While the AI works you see its progress. When it is done, the card shows <b>What changed</b> (how many files, how many lines added and removed, the biggest files, and a link to every line on GitHub), says what <b>Merge</b> does (it puts the change into your main branch, and your live site updates if your host deploys on merge) and that you can undo it, and then <b>Merge</b> does it. If the checks fail, <b>Ask the AI to fix it</b> sends the AI back with the failing checks already filled in. For an Epic, <b>Split it into steps</b> breaks it up first. The welcome pages show this same card for your first change. Everything else is folded into one row called <b>Details and overrides</b>: the status, what the idea depends on, its stories, the scope, the plan itself (the build prompt, where <b>Generate build prompt</b> writes it and Regenerate writes it again), and the run options and history.
        </P>
        <ol className="mt-3 space-y-2 text-gray-700 dark:text-gray-300 list-decimal pl-5">
          <li>Add the idea, then press <b>Plan it</b>. The AI sizes it and writes the plan; read the plan in <b>Details and overrides</b> if you like.</li>
          <li>Press <b>Build it</b>. The line above the button says what that size typically takes and costs, and the button itself says the most it should cost. Leave it as it is for now. To see or change the model, its effort or the turn limit first, press <b>Adjust model and turns</b>, change them under <b>Run options and history</b>, and press <b>Approve and run</b>.</li>
          <li>It takes a few minutes. The status moves from &quot;Starting&quot; to &quot;AI is working&quot; to &quot;PR ready for review&quot;, and you can watch a clock and the stage it is in.</li>
          <li>When it says <b>Build and tests passed</b>, open the pull request link and look at what changed.</li>
          <li>Press <b>Merge</b>. The idea is marked done, with a closing note drafted from what the AI said.</li>
        </ol>

        <H id="daily">Everyday use</H>
        <UL>
          <li><b>Big ideas:</b> press Split it into steps (or Break into stories under Details and overrides). The AI splits it into small steps that build on each other. You build them one at a time, in order, and merge each before the next.</li>
          <li><b>Not quite right?</b> Use Ask for changes on the pull request and say what to adjust, in plain words. The AI updates the same proposal.</li>
          <li><b>Changed your mind after merging?</b> Right after a change ships, the idea shows <b>Changed your mind?</b> with a <b>Revert this change</b> button. It creates a new proposal that undoes the change and nothing is undone until you merge it: press <b>Merge the revert</b>, like any other merge. The same button stays under Details and overrides.</li>
          <li><b>AI model:</b> chosen automatically from the size of the idea. Small ideas use a cheap, fast model, big ones a stronger one, and the AI will not build an idea until it has a size, so a small idea never starts on an expensive model by accident. You can change it before each run, and set a project to lean cheaper or stronger.</li>
          <li><b>Imported many ideas?</b> Press <b>Plan them all</b> at the top of the board. Each idea that has no plan yet gets its size and its plan, one by one, up to ten per press, and only the ideas your filters show are planned. An Epic is sized but not planned: open it and split it into steps first. You can also press <b>Plan it</b> on a single row.</li>
          <li><b>Bugs:</b> when you add something, choose <b>A bug</b>. Say what happens, give the steps to reproduce it and how bad it is. The AI first tries to reproduce the problem with a test that fails, then fixes the cause. If it cannot reproduce it, it changes nothing and says so, and you get your run back. The more exact your steps, the better the fix. Use the type filter on the board to see only bugs, and <b>Most reported</b> to see which ones customers hit most.</li>
          <li><b>See it running:</b> if your hosting builds a preview of every pull request (Vercel, Netlify and Cloudflare Pages do), a <b>See it running</b> button appears next to the PR a minute or two after it opens. Open it to try the change before you merge. If it says &quot;No preview link yet&quot;, your host has not posted one (yet).</li>
          <li><b>Email:</b> you get an email when a change is ready for review, when a revision is ready again, or when the AI could not finish. Turn it off under <b>Settings</b> in the menu.</li>
          <li><b>Watching a run:</b> while the AI works, the idea shows a clock and a short list of stages (getting your code ready, the AI working, handing over, build and tests, saving, opening the pull request) with the current one marked. It is checked with GitHub every few seconds, so a moving stage means real progress. The AI stage is the slow one and can take several minutes. You can leave the page: the run keeps going on GitHub.</li>
          <li><b>Many ideas at once:</b> one run per project at a time, so changes do not collide. Queue the rest.</li>
          <li><b>Light or dark:</b> use the <b>Light / Dark</b> switch in the menu. Idea HQ remembers your choice on this device. The first time, it follows your device&apos;s setting.</li>
        </UL>

        <H id="ideas">Writing good ideas</H>
        <UL>
          <li><b>One thing per idea.</b> &quot;Add a search box to the ideas page&quot; is better than &quot;improve the ideas page&quot;.</li>
          <li><b>Say what done looks like.</b> &quot;When I type in the box, the list shows only matching ideas.&quot;</li>
          <li><b>Mention what to leave alone</b> if it matters. &quot;Do not change the sign-in page.&quot;</li>
          <li><b>Too big?</b> If the size says Large or Epic, break it into stories first. Smaller steps are cheaper and fail less. An Epic is better split than built in one go; you can still build it as one if you choose.</li>
        </UL>

        <P>
          Already have a TODO.md, a Notion page or any list of ideas? Press <b>Import ideas</b> on the project (it is also offered during setup). Idea HQ looks for a TODO file in your repo, or you paste or upload the list, the AI turns it into separate ideas, and you tick which ones to keep before anything is saved.
        </P>

        <H id="board">Your board and Focus</H>
        <P>
          The <b>Ideas</b> page shows every idea from all your projects in one place, so you can see what needs you.
        </P>
        <UL>
          <li><b>Stage and next step:</b> under each idea in the list, a small label says which of the five stages it is in (Describe, Plan, Build, Review or Ship), and beside it is a button for the next step: <b>Plan it</b>, <b>Build it</b>, <b>Merge</b>, <b>Ask the AI to fix it</b>, <b>Try again</b> or <b>Split it into steps</b>. When there is nothing for you to do, it says what is happening instead: the AI or your project&apos;s checks are working, the idea waits for another idea, or it is done. <b>Plan it</b> runs right there; the other buttons open the idea, because building and merging always happen on the idea, where you approve them.</li>
          <li><b>Needs you:</b> the chip at the top of the list counts the ideas waiting for you, such as a finished change to merge, failed checks to fix, a run to try again, or a build ready to start. Press it to see only those, most urgent first: changes waiting to be merged, then failed checks, then failed runs, then builds ready to start.</li>
          <li><b>Status and stage:</b> the stage says where the work is. The status is the coarse label you keep yourself: New, Considering, In progress, Done or Parked. It moves by itself when the AI starts building (In progress) and when you merge (Done), so you rarely touch it, except to park an idea or to finish one by hand.</li>
          <li><b>List or Board:</b> switch at the top. The board has a column for each status (New, Considering, In progress, Done and Parked), and you move an idea by dragging it to another column. Each card on the board also shows its stage and what comes next, in one line.</li>
          <li><b>Find things:</b> search, and filter by project, status, priority, effort, tag, or by <b>Ideas and bugs</b>. Sort by newest, priority, least effort, <b>Quick wins first</b> or <b>Most reported</b>.</li>
          <li><b>Value / effort:</b> a map of the ideas the AI has estimated. <b>Quick wins</b> are high value and little effort, <b>Big bets</b> high value and a lot of effort, <b>Fill-ins</b> lower value and little effort, and <b>Time sinks</b> lower value and a lot of effort.</li>
          <li><b>Focus:</b> the <b>Focus</b> item in the menu lists your top five ideas by value against effort, across all projects. Only estimated ideas that are not done appear, and ideas waiting on another idea are left out until that one ships (it tells you how many).</li>
          <li><b>One thing before another:</b> on an idea, <b>Blocked by</b> lists the ideas that must ship first. When you mark an idea done you can add a short closing note about what shipped.</li>
        </UL>

        <H id="safe">Staying in control</H>
        <UL>
          <li>You approve the plan before anything runs.</li>
          <li>Every change is a pull request you can read. Nothing joins your project until you say yes.</li>
          <li>The build and tests must pass before the merge button works.</li>
          <li>The AI runs in your own GitHub, with a time limit and a limit on how many turns it may take. It only touches the repo you connected.</li>
          <li>Your API key lives in GitHub, not in Idea HQ.</li>
          <li>With workflow version 8 or newer the AI works in a step that can only read your repo, and hands its changes over as a patch. A second step, which never sees your API key, applies the patch, runs your checks and saves the branch. The AI can only run your project&apos;s own npm scripts. After an update, press <b>Update the workflow</b> on a project&apos;s setup page and merge that pull request.</li>
          <li>If your repository is <b>public</b>, anything Idea HQ tells the AI (the idea, its plan, customer text) and what the AI answers can be read by anyone in the repository&apos;s Actions logs and pull requests. Idea HQ shows a notice for public repos, and removes email addresses and phone numbers from customer tickets that become bugs or ideas. Leave out anything private.</li>
          <li>The AI cannot read files that usually hold secrets (such as <code>.env</code>, key files, <code>.npmrc</code> and Terraform variable files), and project knowledge never includes them.</li>
          <li>Auto-merge is off by default. If you turn it on for a project, it only merges when every check is green and the main branch is protected on GitHub.</li>
          <li>You can undo any merged change with one button.</li>
        </UL>

        <H id="cost">What it costs</H>
        <P>
          Two things cost money, and they are separate. The AI work itself is billed by Anthropic to the API key you add to your repo: a Quick change costs cents, a Standard one tens of cents, a Large one a dollar or two, and stronger models cost more per step. Each idea shows what its size typically costs before you approve a run, and after a few runs it shows what your own runs of that size cost. Separately, Idea HQ may ask you to pay for <b>AI build</b> (the Implement and Learn deeply buttons), once the owner switches payments on.
        </P>
        <UL>
          <li><b>Free:</b> you can always add projects and ideas, and use the quick helper steps (estimates, plans, project description), up to a daily limit.</li>
          <li><b>Pro, 99 kr a month:</b> AI build without a limit on runs, and a higher daily limit on the helper steps. Cancel any time from the Billing page; you keep Pro until the month you paid for ends.</li>
          <li><b>50 AI runs, one payment:</b> no subscription. One run is used each time you approve an AI run. A run that fails gives its run back. Revising, merging and undoing never use a run.</li>
          <li><b>Where to upgrade:</b> the <b>Upgrade</b> item in the menu (it says <b>Billing</b> once you have a plan). Payments go through Lemon Squeezy, and your plan updates a few seconds after you pay.</li>
          <li>The owner can give a person free access, so some people never see a payment step.</li>
        </UL>
        <UL>
          <li><b>Spend and cap:</b> the Projects page shows what each project&apos;s AI runs cost this month (when the AI provider reports it). Type a dollar amount in <b>Monthly cap</b> to pause new runs for that project once it is reached. A run that is already working can finish a little over.</li>
          <li>Set a monthly spending limit in your Anthropic account. It is the best safety net.</li>
          <li>Each run has a time limit and a limit on turns, so a stuck run cannot run up a bill forever. A run that uses all its turns before it finishes opens no pull request and says so: press <b>Try again</b> and it gets more turns.</li>
          <li>The cost shown for a change adds up everything it took, including each time you asked the AI for changes after the first pass.</li>
          <li>After each run, Idea HQ shows what it cost.</li>
          <li>The quick helper steps are paid by the Idea HQ owner and limited per person each day.</li>
        </UL>

        <H id="support">Support for your own users</H>
        <P>
          Optional, and switched on per account by the owner. It adds a Help button to your website. Visitors ask a question, get an answer from help notes you wrote and approved, or send you a message. You answer from one inbox called Support, and they get your reply by email.
        </P>
        <UL>
          <li>Open a project, press Support, then Turn on support.</li>
          <li>Under &quot;What the form asks&quot; choose what you need to know, such as an order number. Email and Message are always asked.</li>
          <li>Under &quot;Help notes for the AI&quot; press &quot;Draft notes from my project knowledge&quot;, read each note, fix it, and press Approve. Only approved notes are ever used.</li>
          <li>Under &quot;Put it on your site&quot; add your website to Allowed sites, then press Add it for me (when the project is AI ready, it opens a pull request that adds the button), or copy the code yourself. Use &quot;Check my site&quot; to see that it works.</li>
          <li><b>From a ticket to a bug:</b> open a ticket and use <b>Track this</b>. <b>Turn into a bug</b> (or an idea) pre-fills a form from what the customer wrote. Read it, remove anything you do not want the AI to see, and create it. If several customers report the same thing, use <b>Add to an existing one</b> so they share one bug. The bug shows how many customers asked for it.</li>
          <li><b>Telling customers it is fixed:</b> when the bug is done, open it and press <b>Tell N customers it is done</b>. Each gets your message in their ticket and by email, and their ticket is marked resolved. You can do this once per bug.</li>
          <li>Questions about orders, payments or accounts are never answered by the AI. They always come to you.</li>
          <li>Closed tickets are deleted after the number of days you choose, and you can download or delete everything from one customer.</li>
        </UL>

        <H id="changes">A public What&apos;s new page</H>
        <P>
          Optional, and free. Each project can have a public page where the people who use your product see what you shipped. You decide what appears on it.
        </P>
        <UL>
          <li>Open Projects and press <b>What&apos;s new page</b> on a project, then tick <b>Show a public What&apos;s new page</b>. You get an address you can link from your own site. The address stays the same if you turn the page off and on again.</li>
          <li>Every time a change is merged, a <b>draft</b> appears there with the idea&apos;s title. Nothing is public yet. Reword it for your users, choose New, Fixed or Improved, and press <b>Publish</b>. You can unpublish or delete an entry at any time.</li>
          <li>Changes you made outside Idea HQ can be added by hand with <b>Write an entry by hand</b>.</li>
          <li>The page shows only the title, details and date of published entries. Nothing else from your project is visible, and it is not part of Idea HQ&apos;s own search listing.</li>
        </UL>

        <H id="stuck">If you get stuck</H>
        <Q q="It says &quot;AI build needs Pro or a runs pack&quot;">Payments are switched on and you have no plan or runs left. Open <b>Upgrade</b> in the menu, pick Pro or 50 runs, and come back. It updates by itself a few seconds after you pay.</Q>
        <Q q="It says my Pro was switched off by the owner">The owner can switch off Pro for a person, for example after a refund or a problem with the account. Your subscription is cancelled at the same time, so you are not charged again. Contact the owner if you think this is a mistake. Runs you bought in a pack still work.</Q>
        <Q q="It says the monthly spending cap is reached">You set a cap for that project and this month&apos;s runs have used it up. Raise the cap or clear it under Projects, in the Monthly cap box, and you can continue straight away. It also starts fresh at the beginning of next month.</Q>
        <Q q="I paid but nothing changed">Wait about ten seconds and reload the Billing page. If it still shows nothing after a minute, tell the owner with the email you paid with.</Q>
        <Q q="It says the AI used all its turns">A run has a limit on how many steps the AI may take, so one that goes round in circles cannot run up a bill. This change needed more than it was given, so no pull request was opened and nothing reached your main code. Press <b>Try again</b>: the next try keeps the same AI model and starts with more turns (you can see the number on the button, and change it with Adjust model and turns). Very big ideas go better when you <b>Break into stories</b> first.</Q>
        <Q q="It says &quot;Reconnect GitHub&quot; or that I do not have access to a repository">Idea HQ only works on repositories you can open yourself on GitHub, even when the app is installed on a whole organisation. Open the Projects page and press <b>Connect GitHub</b> once so Idea HQ can check which repositories are yours. If a repository is still refused, you do not have access to it on GitHub: ask its owner, or choose another one.</Q>
        <Q q="How do I get a copy of my data, or delete my account?">Open <b>Settings</b> and look for <b>Your data</b> (if you are still waiting for approval, it is on the waiting page). <b>Download my data</b> gives you one file with your projects, ideas, runs, notes and support tickets. <b>Delete my account</b> removes your account and everything in it for good: type your email address (and your password) to confirm. A running Pro subscription has to be cancelled first so you are not charged again. Your GitHub repositories are not touched; remove the Idea HQ app and the workflow file there yourself if you want them gone.</Q>
        <Q q="It says something is too long, or I reached a limit">Idea HQ keeps each account to sensible sizes so it stays fast and the AI bill stays predictable: titles up to 200 characters, notes up to 20,000, a project description up to 30,000, 50 projects per account and 2,000 ideas per project. Shorten the text, or close or delete things you no longer need.</Q>
        <Q q="I changed my password and it signed me out">That is on purpose. A new password signs you out on every device, so anyone who had your old session is out too. Sign in again with the new password. If you lose a device, open <b>Settings</b> and press <b>Sign out on all devices</b>.</Q>
        <Q q="I signed up but I only see &quot;Waiting for approval&quot;">The owner has to approve new accounts. Nothing is wrong on your side. The page continues by itself once you are approved. If the page also says your email is not confirmed, open the link we emailed you (check spam) or press <b>Send the email again</b>. The owner may wait for the confirmation before approving.</Q>
        <Q q="It says &quot;Too many attempts&quot; when I sign in or sign up">Too many wrong passwords or sign-up tries came from your connection in a short time. This protects accounts from guessing. Wait about 15 minutes for signing in, or an hour for signing up, and try again. Other people are not affected.</Q>
        <Q q="A run seems slow or stuck">While the AI works you see a clock and the stage it is in, checked with GitHub every few seconds. The stage called <b>The AI works on the change</b> is the slow one: several minutes is normal, and a bigger idea can take ten or more. If the stage or the &quot;Confirmed with GitHub&quot; line keeps updating, it is working, and you can leave the page. Every run has a time limit. If GitHub&apos;s finish notice goes missing, Idea HQ asks GitHub itself after a few minutes and carries on from its answer; only if GitHub reports nothing for 45 minutes is the run marked as failed. Idea HQ also goes through the runs nobody has opened once a day, so a run you walked away from does not stay &quot;working&quot; for ever. To look at the live log, open the Actions tab of your repo on GitHub. To stop a run, press <b>Cancel run</b>.</Q>
        <Q q="The AI made no changes">Usually the idea was too vague, or the first model was too small for it. Make the idea more specific and try again. After a run that changed nothing, the next attempt automatically uses a stronger model. Other failures (a missing key, a project that will not install, GitHub trouble) keep the same model, because a stronger one would not fix them. You can also pick a model yourself before approving.</Q>
        <Q q="The run finished but changed nothing">The AI decided it could not or should not make the change, for example because the idea depends on something that is not possible, or it could not reproduce a bug. Open the idea and read <b>What the AI said</b> under the run: it explains why, and the same text appears at the top of a pull request when there is one. You get your run back. This needs the newer workflow: if you see no explanation, open the project&apos;s setup page and press <b>Update the workflow</b>, then merge the pull request.</Q>
        <Q q="GitHub emails me &quot;workflow run failed: No jobs were run&quot; on every push">The Idea HQ workflow file in your repo is an older version (6) that GitHub cannot read. Open the project&apos;s setup page, press <b>Update the workflow</b> and merge the pull request. Until then runs for that project will not start.</Q>
        <Q q="The run failed at &quot;Install dependencies&quot;">Your repo&apos;s <code>package-lock.json</code> does not match its <code>package.json</code>, so <code>npm ci</code> refuses to install. In your repo run <code>npm install</code>, commit the updated <code>package-lock.json</code>, and try again. Repos with a recent workflow carry on anyway and only report the problem at the Verify step.</Q>
        <Q q="The checks failed (red)">The AI&apos;s change did not pass your tests. Use Ask for changes (or Ask the AI to fix it) and paste or describe the problem, or close it and rewrite the idea more simply.</Q>
        <Q q="It says the workflow is outdated">Idea HQ improved the file it installs. Open the project&apos;s Repo and AI setup, click Update workflow, and merge the pull request it opens. This takes a minute.</Q>
        <Q q="&quot;Add your API key&quot; will not tick off">Check that you added it under Secrets (not Variables), and that it is named exactly <code>ANTHROPIC_API_KEY</code> in the same repo you connected, then click Check again. The name must match letter for letter.</Q>
        <Q q="GitHub says it is limiting requests">GitHub allows a fixed number of requests per hour. Wait for the time shown, and avoid pressing Check again repeatedly. Your progress is saved.</Q>
        <Q q="I do not see my repo in the list">The app only sees repos you allowed on GitHub. Use the link under the repo list to give it access to more repos, then come back. The list refreshes by itself.</Q>
        <Q q="Can I use ChatGPT instead of Claude?">When it is switched on for you, choose OpenAI under Repo and AI setup, in &quot;Which AI builds the changes&quot;. You need an API key from platform.openai.com. A ChatGPT subscription does not include one, and it is billed separately. Paste the key once under the API key step and Idea HQ saves it in your repo as a secret named OPENAI_API_KEY, without keeping it. OpenAI runs do not report their cost, so check your OpenAI dashboard, and each run has a hard time limit. Gemini (Google) is coming soon.</Q>
        <Q q="The AI seems confused about my project">Open the project&apos;s knowledge page. Click Learn deeply in my GitHub, or Answer a few questions, and correct anything that is wrong. A missing README or unusual folder layout is the most common cause.</Q>
        <Q q="The AI built something I do not want">That is what the review step is for. Close the pull request, or request changes. Nothing was added to your project.</Q>
        <Q q="I want to start the setup over">Open Projects, then Repo and AI setup on the project. Every step can be redone. Nothing is lost.</Q>

        <div className="mt-12 rounded-xl border border-gray-200 bg-white dark:bg-transparent dark:border-gray-700 p-5 text-center">
          <GuideCta />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
