package com.wallet.fixture.http;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import com.wallet.fixture.model.TransferRecord;
import com.wallet.fixture.model.TransferRequest;
import com.wallet.fixture.model.TransferResult;
import com.wallet.fixture.model.WalletRecord;
import com.wallet.fixture.service.IdempotencyConflictException;
import com.wallet.fixture.service.TransferProcessor;
import com.wallet.fixture.service.ValidationException;
import com.wallet.fixture.service.WalletNotFoundException;
import com.wallet.fixture.service.WalletRepository;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.util.Optional;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.sql.DataSource;

/**
 * HTTP layer of the wallet service fixture, built on the JDK HttpServer. Note the fixed thread
 * pool: the default executor is single-threaded, which would serialize all requests and make the
 * concurrency tests meaningless.
 */
public class WalletTransferServer {

	private static final int REQUEST_THREAD_POOL_SIZE = 16;

	private final HttpServer server;
	private final ExecutorService executor;

	private WalletTransferServer(HttpServer server, ExecutorService executor) {
		this.server = server;
		this.executor = executor;
	}

	public static WalletTransferServer start(DataSource dataSource, int port) {
		try {
			TransferProcessor transferProcessor = new TransferProcessor(dataSource);
			WalletRepository walletRepository = new WalletRepository(dataSource);

			HttpServer httpServer = HttpServer.create(new InetSocketAddress(port), 0);
			ExecutorService executor = Executors.newFixedThreadPool(REQUEST_THREAD_POOL_SIZE);
			httpServer.setExecutor(executor);

			httpServer.createContext("/transfers", new TransfersHandler(transferProcessor));
			httpServer.createContext("/wallets", new WalletsHandler(walletRepository));

			httpServer.start();
			return new WalletTransferServer(httpServer, executor);
		} catch (IOException e) {
			throw new IllegalStateException("Failed to start Wallet Transfer Service on port " + port, e);
		}
	}

	public int port() {
		return server.getAddress().getPort();
	}

	public void stop() {
		server.stop(0);
		executor.shutdownNow();
	}

	private static class TransfersHandler implements HttpHandler {

		private final TransferProcessor transferProcessor;

		private TransfersHandler(TransferProcessor transferProcessor) {
			this.transferProcessor = transferProcessor;
		}

		@Override
		public void handle(HttpExchange exchange) throws IOException {
			String method = exchange.getRequestMethod();
			String path = exchange.getRequestURI().getPath();

			if ("POST".equals(method) && "/transfers".equals(path)) {
				handleCreate(exchange);
			} else if ("GET".equals(method) && path.startsWith("/transfers/")) {
				handleGetById(exchange, path.substring("/transfers/".length()));
			} else {
				HttpResponses.sendError(exchange, 405, "METHOD_NOT_ALLOWED", method + " " + path);
			}
		}

		private void handleCreate(HttpExchange exchange) throws IOException {
			try {
				TransferRequest request = JsonSupport.MAPPER.readValue(exchange.getRequestBody(),
						TransferRequest.class);
				String idempotencyKey = HttpResponses.firstHeader(exchange, "Idempotency-Key");

				TransferResult result = transferProcessor.process(request, idempotencyKey);
				HttpResponses.sendJson(exchange, result.httpStatus(), result.record(), result.idempotentReplay());
			} catch (ValidationException e) {
				HttpResponses.sendError(exchange, 400, "VALIDATION_ERROR", e.getMessage());
			} catch (WalletNotFoundException e) {
				HttpResponses.sendError(exchange, 404, "WALLET_NOT_FOUND", e.getMessage());
			} catch (IdempotencyConflictException e) {
				HttpResponses.sendError(exchange, 409, "IDEMPOTENCY_KEY_CONFLICT", e.getMessage());
			} catch (IOException e) {
				HttpResponses.sendError(exchange, 400, "MALFORMED_JSON",
						"Request body could not be parsed: " + e.getMessage());
			} catch (RuntimeException e) {
				// an unhandled exception must still produce an HTTP response, otherwise the client
				// only sees a bare connection reset with no diagnostic information at all
				e.printStackTrace();
				HttpResponses.sendError(exchange, 500, "INTERNAL_ERROR", String.valueOf(e.getMessage()));
			}
		}

		private void handleGetById(HttpExchange exchange, String transferId) throws IOException {
			Optional<TransferRecord> record;
			try {
				record = transferProcessor.findTransfer(transferId);
			} catch (IllegalArgumentException malformedId) {
				record = Optional.empty();
			}
			if (record.isPresent()) {
				HttpResponses.sendJson(exchange, 200, record.get(), false);
			} else {
				HttpResponses.sendError(exchange, 404, "TRANSFER_NOT_FOUND", "No transfer with id " + transferId);
			}
		}
	}

	private static class WalletsHandler implements HttpHandler {

		private final WalletRepository walletRepository;

		private WalletsHandler(WalletRepository walletRepository) {
			this.walletRepository = walletRepository;
		}

		@Override
		public void handle(HttpExchange exchange) throws IOException {
			String method = exchange.getRequestMethod();
			String path = exchange.getRequestURI().getPath();

			if (!"GET".equals(method) || !path.startsWith("/wallets/")) {
				HttpResponses.sendError(exchange, 405, "METHOD_NOT_ALLOWED", method + " " + path);
				return;
			}

			String walletId = path.substring("/wallets/".length());
			Optional<WalletRecord> wallet = walletRepository.findById(walletId);
			if (wallet.isPresent()) {
				HttpResponses.sendJson(exchange, 200, wallet.get(), false);
			} else {
				HttpResponses.sendError(exchange, 404, "WALLET_NOT_FOUND", "No wallet with id " + walletId);
			}
		}
	}

	/** Shared response-writing helpers, kept out of the handlers to avoid duplicated I/O boilerplate. */
	private static class HttpResponses {

		private HttpResponses() {
		}

		static void sendJson(HttpExchange exchange, int status, Object body, boolean idempotentReplay)
				throws IOException {
			byte[] bytes = JsonSupport.MAPPER.writeValueAsBytes(body);
			exchange.getResponseHeaders().add("Content-Type", "application/json");
			if (idempotentReplay) {
				exchange.getResponseHeaders().add("Idempotency-Replayed", "true");
			}
			exchange.sendResponseHeaders(status, bytes.length);
			try (OutputStream responseBody = exchange.getResponseBody()) {
				responseBody.write(bytes);
			}
		}

		static void sendError(HttpExchange exchange, int status, String errorCode, String message)
				throws IOException {
			sendJson(exchange, status, new ErrorResponse(errorCode, message), false);
		}

		static String firstHeader(HttpExchange exchange, String name) {
			var values = exchange.getRequestHeaders().get(name);
			return values == null || values.isEmpty() ? null : values.get(0);
		}
	}
}
