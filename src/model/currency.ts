import z from "zod";

export const CurrencyCodeSchema = z.enum(["USD", "GEL"]);
