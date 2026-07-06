/* Re-export of the classify CLI driver. Keeps a single source of behavior.
   If divergence is ever needed, fork here. */
export {
  callCli,
  extractJson,
  type CliKind,
  type RawResult,
} from '../../classify/src/cli-driver.ts';
