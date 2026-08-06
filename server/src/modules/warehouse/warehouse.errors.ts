export class WarehouseApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(`Catalog source API error ${status}: ${message}`);
  }
}
