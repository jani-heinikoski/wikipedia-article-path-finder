/**
 * Author: Jani Heinikoski
 * Created: 22.04.2022
 * Sources:
 * [1] MediaWiki, ‘API:Links - MediaWiki’, API:Links. https://www.mediawiki.org/wiki/API:Links (accessed Apr. 22, 2022).
 * [2] ‘Wikipedia:Namespace’, Wikipedia. Jan. 25, 2022. Accessed: Apr. 22, 2022. [Online]. Available: https://en.wikipedia.org/w/index.php?title=Wikipedia:Namespace&oldid=1067769773
 * [3] ‘Breadth-First Search in Javascript’. https://www.algorithms-and-technologies.com/bfs/javascript (accessed Apr. 22, 2022).
 * [4] Senthe, ‘Answer to “Splitting a JS array into N arrays”’, Stack Overflow, Jul. 25, 2018. https://stackoverflow.com/a/51514813 (accessed Apr. 22, 2022).
 * [5] ‘Breadth First Search or BFS for a Graph’, GeeksforGeeks, Mar. 20, 2012. https://www.geeksforgeeks.org/breadth-first-search-or-bfs-for-a-graph/ (accessed Apr. 22, 2022).
 */
const fetch = require("node-fetch");
const cluster = require("cluster");
const { cpus } = require("os");
const express = require("express");
const { body, param, validationResult } = require("express-validator");

// Utility function for splitting an array into n equal sized parts. [4]
const splitArray = (arr, n) => {
    let result = [];
    for (let i = n; i > 0; i--) {
        result.push(arr.splice(0, Math.ceil(arr.length / i)));
    }
    return result;
};

// Search the target article [3], [5]
const search = async (startingTitles, targetTitle) => {
    // Stop the search after 30 minutes
    setTimeout(() => {
        console.log("Did not find the target title");
        process.send({ found: false });
    }, 1000 * 60 * 30);
    // Remaining non-visited links
    let remainingTitles = startingTitles;
    // Map structure to keep track whether we have already visited a certain title
    let visitedTitles = [];
    // The starting titles have already been checked by the master process
    startingTitles.forEach((title) => (visitedTitles[title] = true));
    let currentTitle;
    let childTitles;
    // While the remainingTitles queue is not empty
    while (remainingTitles.length > 0) {
        // Get the first title in the queue and get all the child titles from articles linked to it
        currentTitle = remainingTitles.shift();
        childTitles = await getLinkedTitlesOfPage(currentTitle);
        if (Array.isArray(childTitles)) {
            for (const childTitle of childTitles) {
                if (childTitle.toLowerCase() === targetTitle.toLowerCase()) {
                    // Message the main process that we found the target title and send also the direct ancestor
                    // from which we found the target title.
                    if (!cluster.worker.isDead()) {
                        process.send({
                            found: true,
                            directAncestor: currentTitle,
                        });
                    }
                    return true;
                }
                // Mark the titles as already visited
                if (!visitedTitles[childTitle]) {
                    visitedTitles[childTitle] = true;
                    remainingTitles.push(childTitle);
                }
            }
        }
    }
    return false;
};

// Get the titles of the articles that have links in a Wikipedia page defined by arg pageTitle [1]
const getLinkedTitlesOfPage = async (pageTitle) => {
    // Request params
    const baseURL = `https://en.wikipedia.org/w/api.php?origin=*&action=query&titles=${pageTitle}&format=json&prop=links&pllimit=max`;
    try {
        let firstRequest = true;
        let fetchURL = baseURL;
        let responseAsJSON = null;
        const titles = [];
        do {
            // Check if it is the first request because we have to use the plcontinue if there are more than 500 links
            if (!firstRequest) {
                fetchURL =
                    baseURL +
                    "&plcontinue=" +
                    responseAsJSON.continue.plcontinue;
            }
            responseAsJSON = await (
                await fetch(fetchURL, {
                    method: "GET",
                    headers: {
                        "User-Agent": "wiki-article-finder-v1",
                    },
                })
            ).json();
            firstRequest = false;
            for (const page in responseAsJSON.query.pages) {
                // Skip if there are no links
                if (!Array.isArray(responseAsJSON.query.pages[page].links)) {
                    continue;
                }
                for (const link of responseAsJSON.query.pages[page].links) {
                    // Select only links with namespace equal to zero. [2]
                    if (link.ns === 0) {
                        titles.push(link.title);
                    }
                }
            }
        } while (responseAsJSON.continue);
        return titles;
    } catch (e) {
        console.error(e);
    }
    return null;
};

// Fired when the master process receives a message from a worker
const onMasterReceivedMsg = (obj, worker, res) => {
    if (!obj) {
        return;
    }
    // Obj.found indicates
    if (obj.found) {
        for (const worker of Object.values(cluster.workers)) {
            worker.kill();
        }
        res.status(200).json(obj);
    } else {
        // Target not found by a worker (exhausted all possible paths) --> kill it and respond to the client
        worker.kill();
        // Check if all workers are dead already
        for (const worker of Object.values(cluster.workers)) {
            if (!worker.isDead()) {
                return;
            }
        }
        res.status(404).json({ found: false, directAncestor: null });
    }
};

const onWorkerReceivedMsg = async (obj) => {
    if (!obj) {
        return;
    }
    // If there are no
    if (obj.titles.length === 0) {
        console.log("Did not find the target title");
        process.send({ found: false });
        return;
    }
    // "Fire and forget" search
    search(obj.titles, obj.targetTitle);
};

// Fired when a worker exits
const onWorkerExit = (code, signal, worker) => {
    console.log(`Worker ${worker.id} exited`);
    if (signal) {
        console.log(`Signal was: ${signal}`);
    } else if (code !== 0) {
        console.log(`Error code was: ${code}`);
    }
};

// Forking and initialization
if (cluster.isPrimary) {
    console.log(`Master running PID ${process.pid}`);
    const app = express();
    // Handle HTTP GET requests to route /api/v1/:fromArticle/:toArticle
    app.get(
        "/api/v1/:startTitle/:targetTitle",
        param("startTitle").isString().notEmpty(),
        param("targetTitle").isString().notEmpty(),
        async (req, res) => {
            // Check if params passed the express-validator
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ msg: "Invalid request params." });
            }
            if (
                req.params.startTitle.normalize().toLowerCase() ===
                req.params.targetTitle.normalize().toLowerCase()
            ) {
                return res.status(200).json({
                    found: true,
                    directAncestor: req.params.startTitle,
                });
            }
            const startingTitles = await getLinkedTitlesOfPage(
                req.params.startTitle
            );
            // Check if the target link is already within the starting page
            for (const title of startingTitles) {
                if (
                    title.normalize().toLowerCase() ===
                    req.params.targetTitle.normalize().toLowerCase()
                ) {
                    return res.status(200).json({
                        found: true,
                        directAncestor: req.params.startTitle,
                    });
                }
            }
            // Fork workers
            for (let i = 0; i < Math.max(cpus().length, 12); i++) {
                let worker = cluster.fork();
                worker.on("message", (obj) =>
                    onMasterReceivedMsg(obj, worker, res)
                );
                worker.on("exit", (code, signal) =>
                    onWorkerExit(code, signal, worker)
                );
            }
            // Split the first titles among the workers and send them for processing
            const workersTitles = splitArray(
                startingTitles,
                Math.max(cpus().length, 12)
            );
            let i = 0;
            for (const worker of Object.values(cluster.workers)) {
                worker.send({
                    targetTitle: req.params.targetTitle,
                    titles: workersTitles[i++],
                });
            }
        }
    );
    // Start the Express server on port 3000
    app.listen(3000);
} else {
    console.log(`worker started PID ${process.pid}`);
    // Event listener for messages from the process
    process.on("message", onWorkerReceivedMsg);
}
