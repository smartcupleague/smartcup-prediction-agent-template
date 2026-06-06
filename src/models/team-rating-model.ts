import type { MatchRatingView, SmartCupMatch, TeamRating, TeamRatingView } from '../types/index.js';

export type TeamRatingModelOptions = {
  defaultRating?: number;
  homeAdvantage?: number;
  ratingScale?: number;
  seededRatings?: TeamRating[];
};

const DEFAULT_UPDATED_AT = '2026-05-30T00:00:00.000Z';

export const DEFAULT_TEAM_RATINGS: TeamRating[] = [
  { team: 'Argentina', rating: 1870, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'France', rating: 1860, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Spain', rating: 1840, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'England', rating: 1830, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Brazil', rating: 1825, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Portugal', rating: 1810, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Netherlands', rating: 1785, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Belgium', rating: 1765, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Germany', rating: 1760, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Uruguay', rating: 1745, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Colombia', rating: 1735, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Morocco', rating: 1725, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Croatia', rating: 1720, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Japan', rating: 1705, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Mexico', rating: 1700, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'United States', rating: 1695, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1, aliases: ['USA'] },
  { team: 'Switzerland', rating: 1690, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Senegal', rating: 1680, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Ecuador', rating: 1675, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Austria', rating: 1670, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Turkey', rating: 1665, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'South Korea', rating: 1660, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Australia', rating: 1625, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Canada', rating: 1620, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Scotland', rating: 1615, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Czechia', rating: 1610, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1, aliases: ['Czech Republic'] },
  { team: 'Norway', rating: 1605, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Ivory Coast', rating: 1600, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1, aliases: ["Côte d'Ivoire", 'Cote dIvoire'] },
  { team: 'Egypt', rating: 1595, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Tunisia', rating: 1585, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Algeria', rating: 1580, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'South Africa', rating: 1565, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Saudi Arabia', rating: 1560, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Qatar', rating: 1550, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Panama', rating: 1545, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Paraguay', rating: 1540, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Ghana', rating: 1535, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'New Zealand', rating: 1525, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Jordan', rating: 1520, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Iraq', rating: 1515, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Uzbekistan', rating: 1510, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Congo DR', rating: 1505, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1, aliases: ['DR Congo'] },
  { team: 'Iran', rating: 1500, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Cape Verde Islands', rating: 1495, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1, aliases: ['Cape Verde'] },
  { team: 'Haiti', rating: 1485, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
  { team: 'Curaçao', rating: 1475, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1, aliases: ['Curacao'] },
  { team: 'Bosnia-Herzegovina', rating: 1470, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1, aliases: ['Bosnia and Herzegovina'] },
  { team: 'Sweden', rating: 1660, source: 'operator_seed', updatedAt: DEFAULT_UPDATED_AT, sampleSize: 1 },
];

export class TeamRatingModel {
  private readonly defaultRating: number;
  private readonly homeAdvantage: number;
  private readonly ratingScale: number;
  private readonly ratingsByKey = new Map<string, TeamRating>();
  private readonly canonicalByKey = new Map<string, string>();

  constructor(options: TeamRatingModelOptions = {}) {
    this.defaultRating = options.defaultRating ?? 1500;
    this.homeAdvantage = options.homeAdvantage ?? 35;
    this.ratingScale = options.ratingScale ?? 400;

    for (const rating of options.seededRatings ?? DEFAULT_TEAM_RATINGS) {
      this.addRating(rating);
    }
  }

  rateMatch(match: Pick<SmartCupMatch, 'home' | 'away'>): MatchRatingView {
    const home = this.getTeamRating(match.home);
    const away = this.getTeamRating(match.away);
    const adjustedHomeRating = home.rating + this.homeAdvantage;
    const adjustedAwayRating = away.rating;
    const ratingDiff = adjustedHomeRating - adjustedAwayRating;
    const expectedHomeResult = logisticExpectedResult(ratingDiff, this.ratingScale);

    return {
      home,
      away,
      homeAdvantage: this.homeAdvantage,
      adjustedHomeRating,
      adjustedAwayRating,
      ratingDiff,
      expectedHomeResult,
      expectedAwayResult: 1 - expectedHomeResult,
      confidence: confidenceFromRatings(home, away),
    };
  }

  getTeamRating(team: string): TeamRatingView {
    const key = normalizeTeamKey(team);
    const canonicalTeam = this.canonicalByKey.get(key);
    const rating = canonicalTeam ? this.ratingsByKey.get(normalizeTeamKey(canonicalTeam)) : undefined;

    if (!rating) {
      return {
        team,
        canonicalTeam: team,
        rating: this.defaultRating,
        source: 'default',
        sampleSize: 0,
        isDefault: true,
      };
    }

    return {
      team,
      canonicalTeam: rating.team,
      rating: rating.rating,
      source: rating.source,
      sampleSize: rating.sampleSize,
      isDefault: false,
    };
  }

  updateFromResult(input: {
    homeTeam: string;
    awayTeam: string;
    homeScore: number;
    awayScore: number;
    kFactor?: number;
    playedAt?: string;
  }): void {
    const kFactor = input.kFactor ?? 20;
    const home = this.getTeamRating(input.homeTeam);
    const away = this.getTeamRating(input.awayTeam);
    const expectedHome = logisticExpectedResult(home.rating + this.homeAdvantage - away.rating, this.ratingScale);
    const actualHome = input.homeScore === input.awayScore ? 0.5 : input.homeScore > input.awayScore ? 1 : 0;
    const delta = kFactor * (actualHome - expectedHome);
    const updatedAt = input.playedAt ?? new Date().toISOString();

    this.addRating({
      team: home.canonicalTeam,
      rating: Math.round(home.rating + delta),
      source: 'result_update',
      updatedAt,
      sampleSize: home.sampleSize + 1,
    });
    this.addRating({
      team: away.canonicalTeam,
      rating: Math.round(away.rating - delta),
      source: 'result_update',
      updatedAt,
      sampleSize: away.sampleSize + 1,
    });
  }

  private addRating(rating: TeamRating): void {
    const canonicalKey = normalizeTeamKey(rating.team);
    this.ratingsByKey.set(canonicalKey, rating);
    this.canonicalByKey.set(canonicalKey, rating.team);

    for (const alias of rating.aliases ?? []) {
      this.canonicalByKey.set(normalizeTeamKey(alias), rating.team);
    }
  }
}

function logisticExpectedResult(ratingDiff: number, scale: number): number {
  return 1 / (1 + 10 ** (-ratingDiff / scale));
}

function confidenceFromRatings(home: TeamRatingView, away: TeamRatingView): number {
  const knownTeams = Number(!home.isDefault) + Number(!away.isDefault);
  const sampleScore = Math.min(1, (home.sampleSize + away.sampleSize) / 20);
  return Number(((knownTeams / 2) * 0.7 + sampleScore * 0.3).toFixed(4));
}

function normalizeTeamKey(team: string): string {
  return team
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}
