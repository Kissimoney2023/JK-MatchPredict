export const state = {
  leagues: [],
  fixtures: [],
  picks: [],
  league: 'all',
  status: 'all',
  query: '',
  page: 1,
  view: 'matches',
  busy: false,
  connected: false,
  providers: [],
  source: '',
  at: null,
  listing: null,
  analysis: null,
  demo: false,
};

export const PAGE_SIZE = 20;

const LIVE = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT'];
const FINISHED = ['FT', 'AET', 'PEN'];

export const isLive = (f) => LIVE.includes(f.status);
export const isFinished = (f) => FINISHED.includes(f.status);
export const isOpen = (f) => f.status === 'NS' && Date.parse(f.kickoff) > Date.now();
