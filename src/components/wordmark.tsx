import { Rocket } from "lucide-react";
import { Underline } from "./landing/notebook";

// Dark theme: the rocket badge. Light theme: the written name with a pen underline, as on the start page.
export function Wordmark() {
  return (
    <>
      <span className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center light:hidden">
        <Rocket className="w-5 h-5 text-white" />
      </span>
      <span className="flex flex-col">
        <span className="text-lg font-bold text-gray-900 dark:text-white light:text-[22px] light:tracking-[-0.02em]">Idea HQ</span>
        <Underline className="hidden light:block" />
      </span>
    </>
  );
}
