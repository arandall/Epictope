export interface ScoreRow { position: number; normalized_entropy: number; ss_score: number;
  rsa: number; inv_anchor2: number; sum_score: number; min: number; min_feature: string; aa: string; }
export interface Msa { records: { id: string; seq: string }[]; query: string; }
export interface Info { gene: string; organism: string; length: number; reviewed: boolean;
  hasAlphaFold: boolean; af_version?: string; resolution_note?: string;
  top_sites: {position:number;min:number;min_feature:string}[]; }
export interface Job { status: string; error?: string; result?: any; }
