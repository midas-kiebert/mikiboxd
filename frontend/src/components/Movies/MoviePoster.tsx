import { Link } from "@tanstack/react-router"
import { MovieSummaryLoggedIn } from "@/client";

type MoviePosterProps = {
    movie: MovieSummaryLoggedIn;
    size?: string;
};

export default function MoviePoster({
    movie,
    size = "225px"
}: MoviePosterProps) {
    return (
        <Link
            to={"/movie/$movieId"}
            params={{ movieId: `${movie.id}`}}
            style={{
                display: "inline-block",
                height: size,
                 // two thirds of the height
                width: `calc(${size} * 2 / 3)`,
            }}
        >
            <img
                src={movie.poster_link || "https://via.placeholder.com/150"}
                alt={movie.title}
                className="movie-poster"
                style={{
                    height: "100%",
                    width: "auto",
                    objectFit: "cover",
                    display: "block",
                }}
            />
        </Link>
    );
}
