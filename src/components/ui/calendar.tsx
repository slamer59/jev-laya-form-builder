import * as React from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { cn } from "@/lib/utils";

// Uses react-day-picker's default stylesheet, themed with the shadcn tokens.
function Calendar({ className, ...props }: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      className={cn("p-3 text-sm [--rdp-accent-color:var(--primary)] [--rdp-accent-background-color:var(--accent)] [--rdp-day-height:2.25rem] [--rdp-day-width:2.25rem] [--rdp-day_button-height:2.1rem] [--rdp-day_button-width:2.1rem]", className)}
      {...props}
    />
  );
}

export { Calendar };
