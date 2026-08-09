package com.robustrade.wallet;

import com.robustrade.wallet.db.Database;
import com.robustrade.wallet.http.TransferHandler;
import com.robustrade.wallet.http.WalletHandler;
import com.robustrade.wallet.service.ReadService;
import com.robustrade.wallet.service.TransferService;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.concurrent.Executors;

public class Main {

    public static void main(String[] args) throws IOException {
        int port = 8080;
        String jdbcUrl = "jdbc:h2:file:./data/walletdb;DB_CLOSE_ON_EXIT=FALSE;AUTO_SERVER=TRUE";
        start(port, jdbcUrl);
        System.out.println("Wallet Transfer Service listening on http://localhost:" + port);
    }

    public static HttpServer start(int port, String jdbcUrl) throws IOException {
        Database db = new Database(jdbcUrl);
        db.initSchema();

        TransferService transferService = new TransferService(db);
        ReadService readService = new ReadService(db);

        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/transfers", new TransferHandler(transferService, readService));
        server.createContext("/wallets", new WalletHandler(readService));
        server.setExecutor(Executors.newCachedThreadPool());
        server.start();
        return server;
    }
}
