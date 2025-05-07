// Server.js with organized file storage structure
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";

const app = express();
const port = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create base uploads directory if it doesn't exist
const UPLOADS_BASE_DIR = "uploads";
if (!fs.existsSync(UPLOADS_BASE_DIR)) {
    fs.mkdirSync(UPLOADS_BASE_DIR);
    console.log(`Created ${UPLOADS_BASE_DIR} directory`);
}

// Function to sanitize filenames (remove special characters)
function sanitizeFilename(filename) {
    return filename
        .replace(/[^a-zA-Z0-9_.-]/g, '_') // Replace invalid chars with underscore
        .replace(/_+/g, '_'); // Replace multiple underscores with single one
}

// Function to create a unique movie folder name
function createMovieFolderName(title) {
    const timestamp = Date.now();
    const sanitizedTitle = sanitizeFilename(title).slice(0, 30); // Limit title length
    return `${timestamp}-${sanitizedTitle}`;
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        // We'll create a movie-specific folder for each upload
        // Since we don't have the title yet when this function runs,
        // we'll store in a temporary location first
        const tempDir = path.join(UPLOADS_BASE_DIR, "temp");
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }
        cb(null, tempDir);
    },
    filename: function(req, file, cb) {
        // Create a more descriptive filename based on file type
        const fileType = file.fieldname; // "thumbnail" or "video"
        const fileExt = path.extname(file.originalname);
        const baseName = path.basename(file.originalname, fileExt);
        const sanitizedName = sanitizeFilename(baseName);
        const uniqueName = `${fileType}-${Date.now()}-${sanitizedName}${fileExt}`;
        console.log(`Saving file: ${uniqueName}`);
        cb(null, uniqueName);
    }
});

// Create multer instance
const upload = multer({ 
    storage: storage,
    fileFilter: function(req, file, cb) {
        console.log(`Received file: ${file.originalname}, mimetype: ${file.mimetype}`);
        cb(null, true);
    }
}).fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "video", maxCount: 1 }
]);

// Create movies.json file if it doesn't exist
const moviesFile = "movies.json";
if (!fs.existsSync(moviesFile)) {
    fs.writeFileSync(moviesFile, JSON.stringify([]));
    console.log("Created movies.json file");
}

// Handle file uploads
app.post("/upload", (req, res) => {
    console.log("Received upload request");
    
    // Use multer to process the uploaded files
    upload(req, res, function(err) {
        if (err instanceof multer.MulterError) {
            console.error("Multer error:", err);
            return res.status(500).json({ message: `Multer error: ${err.message}` });
        } else if (err) {
            console.error("Unknown error:", err);
            return res.status(500).json({ message: `Unknown error: ${err.message}` });
        }
        
        console.log("Files received:", req.files);
        console.log("Form data:", req.body);
        
        // Process the upload
        try {
            const { title, description, thumbnailURL, videoURL } = req.body;
            
            if (!title || !description) {
                return res.status(400).json({ message: "Title and description are required" });
            }

            // Create a unique folder for this movie
            const movieFolderName = createMovieFolderName(title);
            const movieFolderPath = path.join(UPLOADS_BASE_DIR, movieFolderName);
            
            // Create the movie folder
            if (!fs.existsSync(movieFolderPath)) {
                fs.mkdirSync(movieFolderPath);
                console.log(`Created movie folder: ${movieFolderPath}`);
            }

            let thumbnailPath, videoPath;
            
            // Move thumbnail file from temp to movie folder if uploaded
            if (req.files && req.files["thumbnail"] && req.files["thumbnail"].length > 0) {
                const thumbnailFile = req.files["thumbnail"][0];
                const originalPath = thumbnailFile.path;
                const newPath = path.join(movieFolderPath, thumbnailFile.filename);
                
                // Move the file
                fs.renameSync(originalPath, newPath);
                thumbnailPath = `/uploads/${movieFolderName}/${thumbnailFile.filename}`;
                console.log(`Moved thumbnail to: ${newPath}`);
            } else if (thumbnailURL) {
                thumbnailPath = thumbnailURL;
                console.log(`Using thumbnail URL: ${thumbnailPath}`);
                
                // Save URL to a text file for reference
                fs.writeFileSync(
                    path.join(movieFolderPath, "thumbnail-url.txt"),
                    thumbnailURL
                );
            }

            // Move video file from temp to movie folder if uploaded
            if (req.files && req.files["video"] && req.files["video"].length > 0) {
                const videoFile = req.files["video"][0];
                const originalPath = videoFile.path;
                const newPath = path.join(movieFolderPath, videoFile.filename);
                
                // Move the file
                fs.renameSync(originalPath, newPath);
                videoPath = `/uploads/${movieFolderName}/${videoFile.filename}`;
                console.log(`Moved video to: ${newPath}`);
            } else if (videoURL) {
                videoPath = videoURL;
                console.log(`Using video URL: ${videoPath}`);
                
                // Save URL to a text file for reference
                fs.writeFileSync(
                    path.join(movieFolderPath, "video-url.txt"),
                    videoURL
                );
            }

            // Save metadata in a dedicated file
            const metadataFile = path.join(movieFolderPath, "metadata.json");
            const metadata = {
                id: Date.now().toString(),
                title,
                description,
                uploadDate: new Date().toISOString(),
                thumbnail: thumbnailPath || "",
                video: videoPath || ""
            };
            
            fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));
            console.log(`Saved metadata to: ${metadataFile}`);
            
            if (!thumbnailPath && !videoPath) {
                // Clean up empty folder if no files were provided
                fs.rmdirSync(movieFolderPath);
                return res.status(400).json({ message: "Please provide at least one thumbnail and one video (file or URL)" });
            }

            // Add to movies.json as well
            const newMovie = {
                id: metadata.id,
                title,
                description,
                folderPath: movieFolderName,
                thumbnail: thumbnailPath || "",
                video: videoPath || "",
                uploadDate: metadata.uploadDate
            };

            // Read existing movies, add new one, and write back to file
            let movies = [];
            try {
                const data = fs.readFileSync(moviesFile, 'utf8');
                movies = JSON.parse(data);
                console.log(`Read ${movies.length} existing movies`);
            } catch (error) {
                console.error("Error reading movies file:", error);
                movies = [];
            }
            
            movies.push(newMovie);
            
            fs.writeFileSync(moviesFile, JSON.stringify(movies, null, 2));
            console.log(`Added new movie: ${newMovie.title}`);

            res.status(200).json({ 
                message: "Movie added successfully", 
                movie: newMovie,
                folderPath: movieFolderName
            });
            
        } catch (error) {
            console.error("Error processing upload:", error);
            res.status(500).json({ message: `Server error: ${error.message}` });
        }
    });
});

// Add route to get all movies
app.get("/api/movies", (req, res) => {
    try {
        const data = fs.readFileSync(moviesFile, 'utf8');
        const movies = JSON.parse(data);
        res.json(movies);
    } catch (error) {
        console.error("Error reading movies:", error);
        res.status(500).json({ message: "Error reading movies" });
    }
});

// Add route to get a single movie by ID
app.get("/api/movies/:id", (req, res) => {
    try {
        const data = fs.readFileSync(moviesFile, 'utf8');
        const movies = JSON.parse(data);
        const movie = movies.find(m => m.id === req.params.id);
        
        if (!movie) {
            return res.status(404).json({ message: "Movie not found" });
        }
        
        res.json(movie);
    } catch (error) {
        console.error("Error reading movie:", error);
        res.status(500).json({ message: "Error reading movie" });
    }
});

// Add a route to check if server is running
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'adminPage.html'));
});


app.get("/api/status", (req, res) => {
    res.json({ status: "ok", message: "Server is running" });
});

// Serve static files
app.use("/uploads", express.static(path.join(__dirname, UPLOADS_BASE_DIR)));
console.log(`Serving uploads from: ${path.join(__dirname, UPLOADS_BASE_DIR)}`);

// Serve frontend files
app.use(express.static(path.join(__dirname, "frontend")));
console.log(`Serving frontend from: ${path.join(__dirname, "frontend")}`);

// Catch-all route handler
app.use((req, res) => {
    console.log(`404 - Route not found: ${req.method} ${req.url}`);
    res.status(404).send("Not found");
});

// Error handler
app.use((err, req, res, next) => {
    console.error(`Error: ${err.message}`);
    res.status(500).json({ message: "Server error", error: err.message });
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});