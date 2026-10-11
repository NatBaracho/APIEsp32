import {
  Request,
  Response,
  NextFunction
} from "express";

export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {

  if (res.headersSent) {
    next(error);
    return;
  }

  const httpError = error as Error & {
    status?: number;
    statusCode?: number;
  };
  const reportedStatus =
    httpError.statusCode ?? httpError.status;
  const statusCode =
    typeof reportedStatus === "number" &&
    reportedStatus >= 400 &&
    reportedStatus <= 599
      ? reportedStatus
      : 500;

  console.error(
    "Erro não tratado:"
  );

  console.error(error);

  res.status(statusCode).json({
    success: false,
    message: statusCode < 500
      ? "Requisição inválida"
      : "Erro interno do servidor"
  });

}
