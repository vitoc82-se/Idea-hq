import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";

export const dynamic = "force-dynamic";
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
  ["safe", "Staying in control"],
  ["cost", "What it costs"],
  ["support", "Support for your own users"],
  ["stuck", "If you get stuck"],
];

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="text-2xl font-semibold mt-12 mb-3 scroll-mt-20">{children}</h2>;
}
const P = ({ children }: { children: React.ReactNode }) => <p className="text-gray-700 dark:text-gray-300 leading-relaxed mt-3">{children}</p>;
const UL = ({ children }: { children: React.ReactNode }) => <ul className="list-disc pl-5 space-y-1.5 mt-3 text-gray-700 dark:text-gray-300">{children}</ul>;
const Tip = ({ children }: { children: React.ReactNode }) => (
  <div className="mt-4 rounded-lg border border-emerald-300/60 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 p-3 text-sm text-emerald-900 dark:text-emerald-200">{children}</div>
);

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 mt-5">
      <span className="shrink-0 w-7 h-7 rounded-full bg-emerald-600 text-white text-sm font-medium flex items-center justify-center mt-0.5">{n}</span>
      <div>
        <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
        <div className="text-gray-700 dark:text-gray-300 leading-relaxed mt-1 text-[15px]">{children}</div>
      </div>
    </li>
  );
}

function Q({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="mt-3 rounded-lg border border-gray-200 dark:border-gray-700 p-3 group">
      <summary className="cursor-pointer font-medium text-gray-900 dark:text-white">{q}</summary>
      <div className="mt-2 text-gray-700 dark:text-gray-300 text-[15px] leading-relaxed">{children}</div>
    </details>
  );
}

export default async function GuidePage() {
  const session = await getServerSession(authOptions);
  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100">
      <SiteHeader signedIn={!!session} />
      <main className="max-w-3xl mx-auto px-4 pt-10">
        <h1 className="text-4xl font-bold tracking-tight">How Idea HQ works</h1>
        <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">
          A plain-language guide. No technical background needed. Keep this page handy: it is the answer to most &quot;what do I do now?&quot; moments.
        </p>

        <nav aria-label="Contents" className="mt-6 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-sm font-medium text-gray-500 mb-2">On this page</p>
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
          <li><b>The AI estimates it.</b> A rough size: small, medium, large or extra large.</li>
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
            ["Build prompt", "The plan the AI follows for an idea. It is written for you to read."],
            ["GitHub", "The website where your project's code is stored. Think of it as cloud storage for code that remembers every change."],
            ["Repo (repository)", "Your project's folder on GitHub."],
            ["Branch", "A separate copy of your project to try changes in, so the real one stays untouched. \"main\" is usually the real one."],
            ["Pull request (PR)", "A proposed change. It shows exactly what was added and removed, and waits for your yes or no."],
            ["Merge", "Saying yes: the proposed change joins the real project."],
            ["Checks", "Automatic tests that run on a change, like a spell-check for code. Green means passed, red means a problem."],
            ["API key", "A long secret password that lets the AI work and bills the usage to your Anthropic account. Keep it private."],
            ["Workflow", "A small file in your project that lets GitHub run the AI for you. Idea HQ adds it through a pull request you approve once."],
          ].map(([t, d]) => (
            <div key={t}><dt className="font-semibold text-gray-900 dark:text-white">{t}</dt><dd>{d}</dd></div>
          ))}
        </dl>

        <H id="before">Before you start</H>
        <UL>
          <li><b>A GitHub account.</b> Free. Your project&apos;s code needs to be on GitHub already.</li>
          <li><b>An Anthropic account and an API key.</b> Make one at console.anthropic.com. Set a small monthly spending limit while you learn.</li>
          <li><b>An approved Idea HQ account.</b> After you sign up, the owner approves you. You do not have to do anything while you wait.</li>
        </UL>

        <H id="setup">Setup, step by step</H>
        <P>The app walks you through this and ticks each step off by itself. This is what you will see and why.</P>
        <ol>
          <Step n={1} title="Create your first project">Give it a name. It is only a label for you.</Step>
          <Step n={2} title="Connect GitHub">Click Connect GitHub. GitHub asks you to sign in and allow the app. You choose which repos it may see. Pick only the ones you want to use with Idea HQ. You can change this later in GitHub, under Settings, Applications.</Step>
          <Step n={3} title="Choose the repo and the branch">Pick your project&apos;s repo. For the branch, enter the one that holds your real project, usually <code className="px-1 rounded bg-gray-100 dark:bg-gray-800">main</code>. The AI&apos;s changes will be proposed against it.</Step>
          <Step n={4} title="Set the checks">These are the commands that test a change. The app suggests them from your project, so just click Use them. If you do not know, leaving them empty works, but then nothing tests the AI&apos;s work.</Step>
          <Step n={5} title="Install the workflow">Click the button. Idea HQ opens a pull request in your repo that adds one small file. Open it on GitHub and click Merge. You only do this once per project. It is the file that lets GitHub run the AI for you, with a time limit.</Step>
          <Step n={6} title="Add your API key to the repo">The easiest way is to paste your key into the box in the app: it checks that the key works, saves it in your repo as a secret, and forgets it. Or add it yourself: open the page the app links to. It must be a <b>Secret</b> (the Secrets tab), never a Variable: variables are shown in plain text. Name it <code className="px-1 rounded bg-gray-100 dark:bg-gray-800">ANTHROPIC_API_KEY</code>, paste your key, and save. The key stays in GitHub. Idea HQ never sees it.</Step>
          <Step n={7} title="Teach the AI about your project">Click Read my repo and describe it. The AI looks through your project and writes down what it is, how it is built and how to run it. Read it, then click This looks right, or fix what is wrong. A good description makes every later estimate and plan better. The next section explains how to improve it further.</Step>
        </ol>
        <Tip>Several projects? On a personal GitHub account the key has to be added to each repo once. The app gives you a one-line command to add it to all of them at once.</Tip>

        <H id="knows">How the AI learns your project</H>
        <P>
          The AI can only do good work if it understands your project. Idea HQ keeps a page for that: open Projects and click <b>Knows 60%</b> (or the percentage you see) on any project. It shows what the AI knows, in six plain topics: what it is, the technology, how it is organised, how to run and ship it, rules, and known quirks. Each topic says whether it is <b>Missing</b>, <b>Needs review</b> or <b>Confirmed</b>, and where it came from.
        </P>
        <UL>
          <li><b>Quick draft from my repo:</b> reads the key files in seconds and fills in what it can see. Safe to repeat. It never overwrites what you wrote or confirmed.</li>
          <li><b>Learn deeply in my GitHub:</b> the AI explores your whole project inside your own GitHub, like a new teammate reading the code. It takes a few minutes, uses your Anthropic key (usually under a dollar), and what it writes appears on the page marked Needs review.</li>
          <li><b>Answer a few questions:</b> optional. The AI asks plain questions about the gaps, like what must never change, and adds your answers.</li>
          <li><b>This is right / Edit:</b> check each topic. Anything you edit or confirm is protected, so the AI will not overwrite it later.</li>
          <li><b>Save a copy in my repo:</b> opens a pull request that adds the knowledge to your project as a text file, so other AI tools you use start with the same understanding. Idea HQ always keeps its own copy too.</li>
          <li><b>What it learns over time:</b> after each change, Idea HQ notes what shipped, what you asked to be fixed, and what failed. You can pin the ones that matter, add your own rules, or delete any.</li>
        </UL>
        <Tip>If an estimate or plan feels off, the knowledge is usually the reason. Open the page, fix the topic that is wrong or missing, and generate the plan again.</Tip>

        <H id="first">Your first AI change</H>
        <P>Start tiny, so you learn the loop cheaply. The practice idea (add one line to the README) is perfect.</P>
        <ol className="mt-3 space-y-2 text-gray-700 dark:text-gray-300 list-decimal pl-5">
          <li>Add the idea, then click <b>Generate build prompt</b>. Read the plan it writes.</li>
          <li>Click <b>Implement</b>. You will see which AI model and effort it picked, and why. Leave it as it is for now.</li>
          <li>Click <b>Approve and run</b>. It takes a few minutes. The status moves from &quot;Starting&quot; to &quot;AI is working&quot; to &quot;PR ready for review&quot;.</li>
          <li>When it says <b>Build and tests passed</b>, open the pull request link and look at what changed.</li>
          <li>Click <b>Approve and merge</b>. The idea is marked done.</li>
        </ol>

        <H id="daily">Everyday use</H>
        <UL>
          <li><b>Big ideas:</b> click Break into stories. The AI splits it into small steps that build on each other. You build them one at a time, in order, and merge each before the next.</li>
          <li><b>Not quite right?</b> Use Request changes on the pull request and say what to adjust, in plain words. The AI updates the same proposal.</li>
          <li><b>Changed your mind after merging?</b> Use Revert this change. It creates a new proposal that undoes it, which you approve like any other.</li>
          <li><b>AI model:</b> chosen automatically from the size of the idea. Small ideas use a cheap, fast model, big ones a stronger one. You can change it before each run, and set a project to lean cheaper or stronger.</li>
          <li><b>Imported many ideas?</b> Press <b>Estimate them all</b> at the top of the board. Each idea gets its size one by one, and you can still estimate a single idea with its own button.</li>
          <li><b>Bugs:</b> when you add something, choose <b>A bug</b>. Say what happens, give the steps to reproduce it and how bad it is. The AI first tries to reproduce the problem with a test that fails, then fixes the cause. If it cannot reproduce it, it changes nothing and says so, and you get your run back. The more exact your steps, the better the fix. Use the type filter on the board to see only bugs, and <b>Most reported</b> to see which ones customers hit most.</li>
          <li><b>See it running:</b> if your hosting builds a preview of every pull request (Vercel, Netlify and Cloudflare Pages do), a <b>See it running</b> button appears next to the PR a minute or two after it opens. Open it to try the change before you merge. If it says &quot;No preview link yet&quot;, your host has not posted one (yet).</li>
          <li><b>Email:</b> you get an email when a change is ready for review, when a revision is ready again, or when the AI could not finish. Turn it off under <b>Settings</b> in the menu.</li>
          <li><b>Many ideas at once:</b> one run per project at a time, so changes do not collide. Queue the rest.</li>
        </UL>

        <H id="ideas">Writing good ideas</H>
        <UL>
          <li><b>One thing per idea.</b> &quot;Add a search box to the ideas page&quot; is better than &quot;improve the ideas page&quot;.</li>
          <li><b>Say what done looks like.</b> &quot;When I type in the box, the list shows only matching ideas.&quot;</li>
          <li><b>Mention what to leave alone</b> if it matters. &quot;Do not change the sign-in page.&quot;</li>
          <li><b>Too big?</b> If the estimate says large or extra large, break it into stories first. Smaller steps are cheaper and fail less.</li>
        </UL>

        <P>
          Already have a TODO.md, a Notion page or any list of ideas? Press <b>Import ideas</b> on the project (it is also offered during setup). Idea HQ looks for a TODO file in your repo, or you paste or upload the list, the AI turns it into separate ideas, and you tick which ones to keep before anything is saved.
        </P>

        <H id="safe">Staying in control</H>
        <UL>
          <li>You approve the plan before anything runs.</li>
          <li>Every change is a pull request you can read. Nothing joins your project until you say yes.</li>
          <li>The build and tests must pass before the merge button works.</li>
          <li>The AI runs in your own GitHub, with a time limit and a cap on how many steps it may take. It only touches the repo you connected.</li>
          <li>Your API key lives in GitHub, not in Idea HQ.</li>
          <li>Auto-merge is off by default. If you turn it on for a project, it only merges when every check is green and the main branch is protected on GitHub.</li>
          <li>You can undo any merged change with one button.</li>
        </UL>

        <H id="cost">What it costs</H>
        <P>
          Two things cost money, and they are separate. The AI work itself is billed by Anthropic to the API key you add to your repo: small changes cost cents, a medium change a few tens of cents, bigger ones more, and stronger models cost more per step. Separately, Idea HQ may ask you to pay for <b>AI build</b> (the Implement and Learn deeply buttons), once the owner switches payments on.
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
          <li>Each run has a time limit and a step cap, so a stuck run cannot run up a bill forever.</li>
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

        <H id="stuck">If you get stuck</H>
        <Q q="It says &quot;AI build needs Pro or a runs pack&quot;">Payments are switched on and you have no plan or runs left. Open <b>Upgrade</b> in the menu, pick Pro or 50 runs, and come back. It updates by itself a few seconds after you pay.</Q>
        <Q q="It says my Pro was switched off by the owner">The owner can switch off Pro for a person, for example after a refund or a problem with the account. Your subscription is cancelled at the same time, so you are not charged again. Contact the owner if you think this is a mistake. Runs you bought in a pack still work.</Q>
        <Q q="It says the monthly spending cap is reached">You set a cap for that project and this month&apos;s runs have used it up. Raise the cap or clear it under Projects, in the Monthly cap box, and you can continue straight away. It also starts fresh at the beginning of next month.</Q>
        <Q q="I paid but nothing changed">Wait about ten seconds and reload the Billing page. If it still shows nothing after a minute, tell the owner with the email you paid with.</Q>
        <Q q="I signed up but I only see &quot;Waiting for approval&quot;">The owner has to approve new accounts. Nothing is wrong on your side. The page continues by itself once you are approved.</Q>
        <Q q="The AI made no changes">Usually the idea was too vague, or the first model was too small for it. Make the idea more specific and try again. The next attempt automatically uses a stronger model. You can also pick one yourself before approving.</Q>
        <Q q="The checks failed (red)">The AI&apos;s change did not pass your tests. Use Request changes and paste or describe the problem, or close it and rewrite the idea more simply.</Q>
        <Q q="It says the workflow is outdated">Idea HQ improved the file it installs. Open the project&apos;s Repo and AI setup, click Update workflow, and merge the pull request it opens. This takes a minute.</Q>
        <Q q="&quot;Add your API key&quot; will not tick off">Check that you added it under Secrets (not Variables), and that it is named exactly <code>ANTHROPIC_API_KEY</code> in the same repo you connected, then click Check again. The name must match letter for letter.</Q>
        <Q q="GitHub says it is limiting requests">GitHub allows a fixed number of requests per hour. Wait for the time shown, and avoid pressing Check again repeatedly. Your progress is saved.</Q>
        <Q q="I do not see my repo in the list">The app only sees repos you allowed on GitHub. Use the link under the repo list to give it access to more repos, then come back. The list refreshes by itself.</Q>
        <Q q="Can I use ChatGPT instead of Claude?">When it is switched on for you, choose OpenAI under Repo and AI setup, in &quot;Which AI builds the changes&quot;. You need an API key from platform.openai.com. A ChatGPT subscription does not include one, and it is billed separately. Paste the key once under the API key step and Idea HQ saves it in your repo as a secret named OPENAI_API_KEY, without keeping it. OpenAI runs do not report their cost, so check your OpenAI dashboard, and each run has a hard time limit.</Q>
        <Q q="The AI seems confused about my project">Open the project&apos;s knowledge page. Click Learn deeply in my GitHub, or Answer a few questions, and correct anything that is wrong. A missing README or unusual folder layout is the most common cause.</Q>
        <Q q="The AI built something I do not want">That is what the review step is for. Close the pull request, or request changes. Nothing was added to your project.</Q>
        <Q q="I want to start the setup over">Open Projects, then Repo and AI setup on the project. Every step can be redone. Nothing is lost.</Q>

        <div className="mt-12 rounded-xl border border-gray-200 dark:border-gray-700 p-5 text-center">
          {session ? (
            <Link href="/ideas" className="px-5 py-2.5 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 inline-block">Back to my ideas</Link>
          ) : (
            <>
              <p className="font-semibold">Ready to try it?</p>
              <Link href="/auth/signin?mode=register" className="mt-3 px-5 py-2.5 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 inline-block">Create an account</Link>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
