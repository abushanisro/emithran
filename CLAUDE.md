## UI/UX-Only Change Rules

UI/UX-ONLY CHANGE. Strict rules:

- Change only layout, styling, spacing, colours, typography, icons, and the arrangement of existing elements.
- Do NOT change any formula, calculation, cost logic, API call, hook, data fetching, state logic, validation, routing, permissions, or anything in `backend/`.
- Do NOT rename or remove existing props, fields, buttons, or features. Every existing action must still exist and work.
- Reuse the existing shadcn/ui components in `components/ui`; add new shadcn components only if needed.
- If a design idea needs new data or new behaviour, STOP and tell the user instead of building it.
- Work on one page only. Before finishing: run `npm run type-check`, `npm run lint` and `npm test`, open the page in the browser to check it, and list every file you changed.
