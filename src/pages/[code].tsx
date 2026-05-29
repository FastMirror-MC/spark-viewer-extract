import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { Suspense } from 'react';
import SparkLayout from '../components/SparkLayout';
import TextBox from '../components/TextBox';
import { env } from '../env';

const SparkViewer = dynamic(() => import('../viewer/SparkViewer'));

export default function ViewerPage() {
    const router = useRouter();
    const code = (router.query.code as string) || '_';

    return (
        <>
            {code !== '_' && <ThumbnailMetaTags code={code} />}
            <Suspense
                fallback={
                    <SparkLayout>
                        <TextBox>Loading...</TextBox>
                    </SparkLayout>
                }
            >
                <SparkViewer />
            </Suspense>
        </>
    );
}

const ThumbnailMetaTags = ({ code }: { code: string }) => {
    return (
        <Head>
            <title>{`spark | ${code}`}</title>
            <meta
                property="og:image"
                content={`${env.NEXT_PUBLIC_SPARK_BASE_URL}/thumb/${code}.png`}
                key="og-image"
            />
            <meta
                name="twitter:image"
                content={`${env.NEXT_PUBLIC_SPARK_BASE_URL}/thumb/${code}.png`}
                key="twitter-image"
            />
            <meta
                name="twitter:card"
                content="summary_large_image"
                key="twitter-card"
            />
        </Head>
    );
};
