import { Link } from "@tanstack/react-router"

type MovieCardProps = {
    title: string;
    posterLink?: string | null;
    id: number;
};

export default function MovieCard({ title, posterLink, id }: MovieCardProps) {
    return (
        <>
            <Link
                to={"/movie/$movieId"}
                params={{ movieId: `${id}`}}
                style={{ display: "inline-block", width: "auto" }}
            >
                <img
                    src={posterLink || "https://via.placeholder.com/150"}
                    alt={title}
                    className="movie-poster"
                />
            </Link>
            <h3 className="movie-title">{title}</h3>
        </>
    );
}