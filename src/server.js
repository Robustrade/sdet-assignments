const app = require("./app");

const PORT = 3000;

app.listen(PORT, () => {

    console.log(
        `Wallet Transfer Service running on port ${PORT}`
    );

});