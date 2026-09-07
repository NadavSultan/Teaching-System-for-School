/** Non-authoritative browser fixtures. Production choices are supplied by the API. */
export const gradeFixtures = [
  { grade: '7', label: 'לשון ז׳', source: 'מקור ז׳', eligible: true },
  { grade: '8', label: 'לשון ח׳', source: 'מקור ח׳', eligible: true },
  { grade: '9', label: 'לשון ט׳', source: 'מקור ט׳', eligible: true },
] as const;

export const pilotWorkspaceFixture = gradeFixtures[1];
