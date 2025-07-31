import { Link } from "@tanstack/react-router"
import { MovieSummaryLoggedIn } from "@/client";

type MoviePosterProps = {
    movie: MovieSummaryLoggedIn;
};

export default function MoviePoster({ movie }: MoviePosterProps) {
    return (
        <Link
            to={"/movie/$movieId"}
            params={{ movieId: `${movie.id}`}}
            style={{
                display: "inline-block",
                height: "225px",
                width: "150px"
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
